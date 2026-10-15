import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EstadoPago, EstadoPedido, Prisma } from '@prisma/client';
import { EVENTO_REEMBOLSO_REALIZADO } from '../../notificaciones/eventos';
import { PrismaService } from '../../prisma/prisma.service';
import { esCobroEnEfectivoDelSalon, registrarSalidaEfectivo, TX_HOLGADA } from '../../pos/salidas-caja';
import { incrementarStockPorLineas } from '../common/pedido-inventario.util';
import { MercadoPagoClient } from '../mercadopago/mercadopago.client';
import { ORIGEN_REVOCACION, productoConClienta } from '../pedidos/revocacion';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { AprobarDevolucionDto, RechazarDevolucionDto, RecibirRevocacionDto } from './dto/resolver-devolucion.dto';
import { CAUSAS_POR_TIPO, motivoConPolitica, validarPoliticaDevolucion } from './politica-devolucion';

/** Resolver solicitudes ajenas (crear desde el panel, aprobar, rechazar, ver todas). Admin la tiene con '*'. */
export const PERMISO_GESTIONAR_DEVOLUCIONES = 'devoluciones:gestionar';

export const ESTADOS_DEVOLUCION = ['pendiente', 'aprobada', 'rechazada', 'cancelada'] as const;

/** Solicitudes que todavía comprometen dinero o producto: bloquean otra sobre lo mismo. */
export const ESTADOS_ACTIVOS = ['pendiente', 'aprobada'];

/** Mismo proveedor con el que el webhook registra el pago aprobado (pagos-en-linea.service.ts). */
const PROVEEDOR_MERCADOPAGO = 'mercadopago';

/**
 * Cómo se reintegró una revocación: por Mercado Pago (automático), en efectivo de la caja de quien la recibe,
 * a mano por el mismo medio (terminal o transferencia), o el pago ya estaba reembolsado.
 */
export type ReembolsoRevocacion = 'mercado_pago' | 'efectivo' | 'manual' | 'ya_reembolsado';

/**
 * El reembolso con Mercado Pago espera la API dentro de la transacción (hasta 10 s, más la consulta si falla):
 * así dos peticiones simultáneas no la llaman dos veces. Más holgada que TX_HOLGADA.
 */
const TX_REEMBOLSO_MP = { timeout: 30_000 } as const;

const MENSAJE_REVOCACION_PROCESADA = 'Esta revocación ya se procesó';
const MENSAJE_REVOCACION_POR_REINTEGRAR =
  'Esta revocación ya canceló el pedido y falta reintegrar el pago: resuélvela con "Recibir producto y reembolsar".';

/**
 * Serializa, dentro de la transacción, lo que mueve dinero de un pedido (crear o aprobar devoluciones y
 * reembolsar sus pagos), para que dos peticiones simultáneas no pasen las mismas comprobaciones.
 */
export async function bloquearReembolsosDelPedido(tx: Prisma.TransactionClient, pedidoId: number) {
  const clave = `reembolsos-pedido:${pedidoId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
}

/**
 * Reembolsos ya aprobados de un pedido (devoluciones de tipo reembolso): cuánto dinero ya se devolvió y qué
 * artículos ya regresó la clienta. Una revocación posterior reembolsa solo el resto y esos artículos no vuelven
 * a sumar stock. Se llama dentro de la transacción, con el candado de reembolsos del pedido tomado.
 */
export async function reembolsosAprobadosDelPedido(tx: Prisma.TransactionClient, pedidoId: number) {
  const filas = await tx.devolucion.findMany({
    where: { pedidoId, estado: 'aprobada', tipo: 'reembolso' },
    select: { monto: true, pedidoItemId: true },
  });
  return {
    monto: filas.reduce((suma, d) => suma.plus(d.monto ?? 0), new Prisma.Decimal(0)),
    articulos: new Set(filas.flatMap((d) => (d.pedidoItemId == null ? [] : [d.pedidoItemId]))),
  };
}

/**
 * Cuánto reintegra una revocación: lo pagado menos lo ya reembolsado por devoluciones aprobadas, sin pasar nunca
 * de lo cobrado (el pago aprobado menos esos mismos reembolsos). Hoy el total y el pago coinciden (el webhook y
 * "Cobrar y entregar" cobran el total); el tope blinda el "nunca más de lo cobrado" si alguna vez difieren. Sin
 * pago registrado (pedido marcado pagado a mano) se usa el total. Mismas reglas en revocar y en el detalle del
 * portal (montoRevocable). Dentro de la transacción, con el candado de reembolsos del pedido tomado.
 */
export async function saldoRevocable(tx: Prisma.TransactionClient, pedidoId: number, total: Prisma.Decimal.Value) {
  const previos = await reembolsosAprobadosDelPedido(tx, pedidoId);
  const pago = await tx.pago.findFirst({
    where: { pedidoId, estado: EstadoPago.aprobado },
    orderBy: { id: 'desc' },
    select: { monto: true },
  });
  const cobrado = pago ? Prisma.Decimal.min(total, pago.monto) : new Prisma.Decimal(total);
  return { saldo: Prisma.Decimal.max(cobrado.minus(previos.monto), 0), articulos: previos.articulos };
}

/** Lo que muestra la lista del panel en una sola consulta (sin N+1). */
const INCLUDE_LISTA = {
  pedido: {
    select: { id: true, usuarioId: true, estado: true, total: true, usuario: { select: { id: true, nombre: true, email: true } } },
  },
  pedidoItem: {
    select: { id: true, cantidad: true, subtotal: true, nombreProducto: true, tamanio: true, producto: { select: { nombre: true } } },
  },
  resueltoPor: { select: { id: true, nombre: true } },
} satisfies Prisma.DevolucionInclude;

/** Reembolso total en Mercado Pago (clave por pago). Si falla pero Mercado Pago ya lo tiene reembolsado, cuenta como hecho. */
async function reembolsarEnMercadoPago(mp: MercadoPagoClient | undefined, referencia: string, clave: string) {
  try {
    if (!mp) throw new Error('Sin cliente de Mercado Pago');
    await mp.reembolsarPago(referencia, clave);
  } catch {
    const enMp = await mp?.obtenerPago(referencia).catch(() => null);
    if (enMp?.status !== 'refunded') {
      throw new ServiceUnavailableException('Mercado Pago no respondió y el reembolso no salió. Intenta de nuevo en unos minutos.');
    }
  }
}

@Injectable()
export class DevolucionesService {
  constructor(
    private readonly prisma: PrismaService,
    // Opcional como en AnticiposBarridaService: solo lo usan las revocaciones de compra pagadas en línea.
    @Optional() private readonly mercadoPago?: MercadoPagoClient,
    // Aviso en vivo del reembolso a la clienta (campana y navegador). Opcional como el anterior.
    @Optional() private readonly eventos?: EventEmitter2,
  ) {}

  /** Aviso en vivo a la clienta de un reembolso ya aprobado. Nunca lanza: el reembolso ya quedó guardado. */
  private avisarReembolso(devolucion: { id: number; monto: Prisma.Decimal | null; pedido: { id: number; usuarioId: string | null } | null } | null) {
    if (!this.eventos || !devolucion?.pedido) return;
    try {
      this.eventos.emit(EVENTO_REEMBOLSO_REALIZADO, {
        usuarioId: devolucion.pedido.usuarioId,
        entidadTipo: 'pedido',
        entidadId: devolucion.pedido.id,
        monto: Number(devolucion.monto ?? 0),
        referencia: `devolucion-${devolucion.id}`,
      });
    } catch {
      // Sin aviso en vivo; la clienta lo ve en sus devoluciones.
    }
  }

  /** Claves del rol en permisos_rol; el admin siempre tiene todo. */
  private async puedeGestionar(usuarioId: string): Promise<boolean> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { rol: true } });
    if (!usuario) return false;
    if (usuario.rol === 'admin') return true;
    const permisoRol = await this.prisma.permisoRol.findUnique({ where: { rol: usuario.rol }, select: { claves: true } });
    const claves = permisoRol?.claves ?? [];
    return claves.includes('*') || claves.includes(PERMISO_GESTIONAR_DEVOLUCIONES);
  }

  /**
   * La dueña del pedido siempre; el personal con devoluciones:gestionar solo fuera del portal (sin propios).
   * Lo ajeno responde 404 para no revelar que existe.
   */
  private async assertAccesoPedido(solicitanteId: string, usuarioIdPedido: string, propios: boolean) {
    if (usuarioIdPedido === solicitanteId) return;
    if (!propios && (await this.puedeGestionar(solicitanteId))) return;
    throw new NotFoundException('Pedido no encontrado');
  }

  /** GET /devoluciones: con propios, las de quien consulta; sin propios, todas (requiere la clave). */
  async listar(
    solicitanteId: string,
    filtros: { page?: number; limit?: number; estado?: string; propios?: boolean },
  ) {
    const { page = 1, limit = 20, estado, propios = false } = filtros;
    if (estado && !(ESTADOS_DEVOLUCION as readonly string[]).includes(estado)) {
      throw new BadRequestException(`Estado de devolución inválido: ${estado}`);
    }
    if (!propios && !(await this.puedeGestionar(solicitanteId))) {
      throw new ForbiddenException('No tienes permiso para ver las solicitudes de otras personas');
    }
    const where: Prisma.DevolucionWhereInput = {};
    if (propios) where.pedido = { usuarioId: solicitanteId };
    if (estado) where.estado = estado;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.devolucion.findMany({
        where,
        include: INCLUDE_LISTA,
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.devolucion.count({ where }),
    ]);
    return {
      success: true,
      data,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listarPorPedido(pedidoId: number, solicitanteId: string, propios = false) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, select: { usuarioId: true } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    await this.assertAccesoPedido(solicitanteId, pedido.usuarioId, propios);
    const data = await this.prisma.devolucion.findMany({
      where: { pedidoId },
      include: { pedidoItem: true, pago: true },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string, propios = false) {
    const row = await this.prisma.devolucion.findUnique({
      where: { id },
      include: { pedidoItem: true, pago: true, pedido: { select: { usuarioId: true } } },
    });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    await this.assertAccesoPedido(solicitanteId, row.pedido.usuarioId, propios).catch(() => {
      throw new NotFoundException('Devolución no encontrada');
    });
    const { pedido: _pedido, ...data } = row;
    return { success: true, data };
  }

  async crear(solicitanteId: string, dto: CreateDevolucionDto, propios = false) {
    if (!dto.tipo || !CAUSAS_POR_TIPO[dto.tipo]) throw new BadRequestException('Indica si es cambio o reembolso');
    if (!dto.causa) throw new BadRequestException('Indica la causa del cambio o reembolso');

    const pedido = await this.prisma.pedido.findUnique({
      where: { id: dto.pedidoId },
      select: {
        usuarioId: true,
        estado: true,
        pagadoEn: true,
        metodoPago: true,
        total: true,
        historialEstado: {
          where: { estadoNuevo: { in: ['listo_recoger', 'entregado'] } },
          select: { estadoNuevo: true, creadoEn: true },
          orderBy: { creadoEn: 'desc' },
        },
      },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    await this.assertAccesoPedido(solicitanteId, pedido.usuarioId, propios);

    let subtotalItem: Prisma.Decimal | null = null;
    if (dto.pedidoItemId != null) {
      const item = await this.prisma.pedidoItem.findUnique({
        where: { id: dto.pedidoItemId },
        select: { pedidoId: true, subtotal: true },
      });
      if (!item || item.pedidoId !== dto.pedidoId) {
        throw new BadRequestException('El ítem del pedido no pertenece al pedido indicado');
      }
      subtotalItem = item.subtotal;
    }
    if (dto.pagoId != null) {
      const pago = await this.prisma.pago.findUnique({ where: { id: dto.pagoId }, select: { pedidoId: true } });
      if (!pago || pago.pedidoId !== dto.pedidoId) {
        throw new BadRequestException('El pago no pertenece al pedido indicado');
      }
    }

    // La política se valida siempre en el backend, venga del portal o del panel.
    const entrega = pedido.historialEstado.find((h) => h.estadoNuevo === 'entregado');
    const error = validarPoliticaDevolucion({
      tipo: dto.tipo,
      causa: dto.causa,
      sellado: dto.sellado,
      pedidoItemId: dto.pedidoItemId,
      pedido: {
        estado: pedido.estado,
        pagadoEn: pedido.pagadoEn,
        metodoPago: pedido.metodoPago,
        entregadoEn: entrega?.creadoEn ?? null,
        llegoAListo: pedido.historialEstado.some((h) => h.estadoNuevo === 'listo_recoger'),
      },
    });
    if (error) throw new BadRequestException(error);

    // El monto no lo decide quien solicita: cambio sin monto; reembolso del artículo o del pedido completo.
    const monto = dto.tipo === 'cambio' ? null : (subtotalItem ?? pedido.total);

    const data = await this.prisma.$transaction(async (tx) => {
      await bloquearReembolsosDelPedido(tx, dto.pedidoId);
      // Una sola solicitud activa por artículo; la del pedido completo cubre todos sus artículos.
      const where: Prisma.DevolucionWhereInput = { pedidoId: dto.pedidoId, estado: { in: ESTADOS_ACTIVOS } };
      if (dto.pedidoItemId != null) where.OR = [{ pedidoItemId: dto.pedidoItemId }, { pedidoItemId: null }];
      const activa = await tx.devolucion.findFirst({ where, select: { id: true } });
      if (activa) throw new ConflictException('Ya hay una solicitud activa para este artículo o pedido');

      return tx.devolucion.create({
        data: {
          pedidoId: dto.pedidoId,
          pedidoItemId: dto.pedidoItemId ?? null,
          pagoId: dto.pagoId ?? null,
          estado: 'pendiente',
          tipo: dto.tipo,
          causa: dto.causa,
          // Además de las columnas, el motivo lleva el tipo y la causa legibles al inicio.
          motivo: motivoConPolitica(dto.tipo, dto.causa, dto.motivo),
          monto,
        },
        include: { pedidoItem: true, pago: true },
      });
    }, TX_HOLGADA);
    return { success: true, data };
  }

  /** La dueña retira su solicitud mientras siga pendiente. Lo ajeno responde 404 para cualquier rol. */
  async cancelar(id: number, solicitanteId: string) {
    const row = await this.prisma.devolucion.findUnique({
      where: { id },
      select: { id: true, origen: true, pedido: { select: { usuarioId: true, estado: true } } },
    });
    if (!row || row.pedido.usuarioId !== solicitanteId) throw new NotFoundException('Devolución no encontrada');
    // La revocación ya canceló el pedido: el pago se le debe y no se puede retirar la solicitud.
    if (row.origen === ORIGEN_REVOCACION && row.pedido.estado === EstadoPedido.cancelado) {
      throw new ConflictException('Tu pedido ya se canceló por la revocación: el salón te reintegra tu pago.');
    }
    // Condicionado al estado: si el personal la resolvió en paralelo, no se pisa.
    const { count } = await this.prisma.devolucion.updateMany({
      where: { id, estado: 'pendiente' },
      data: { estado: 'cancelada' },
    });
    if (count === 0) throw new ConflictException('La solicitud ya no está pendiente');
    return { success: true, message: 'Solicitud cancelada' };
  }

  /**
   * Aprobar (personal con devoluciones:gestionar). Un reembolso en efectivo registra en la misma
   * transacción la salida de caja de quien aprueba, que se descuenta en su siguiente corte.
   */
  async aprobar(id: number, resueltoPorId: string, dto: AprobarDevolucionDto) {
    const resultado = await this.prisma.$transaction(async (tx) => {
      const row = await tx.devolucion.findUnique({ where: { id }, select: { id: true, tipo: true, monto: true, pedidoId: true, origen: true } });
      if (!row) throw new NotFoundException('Devolución no encontrada');
      // Aprobarla aquí no regresaría el stock ni reembolsaría por Mercado Pago.
      if (row.origen === ORIGEN_REVOCACION) {
        throw new ConflictException('Esta es una revocación de compra: resuélvela con "Recibir producto y reembolsar".');
      }
      const esReembolso = row.tipo === 'reembolso';
      if (!esReembolso && dto.metodoReembolso) {
        throw new BadRequestException('Solo un reembolso lleva método de reembolso');
      }
      if (esReembolso) await this.assertCabeReembolso(tx, row.pedidoId, id, row.monto);
      const metodoReembolso = esReembolso ? (dto.metodoReembolso ?? 'metodo_original') : null;
      const { count } = await tx.devolucion.updateMany({
        where: { id, estado: 'pendiente' },
        data: {
          estado: 'aprobada',
          resueltoPorId,
          resueltoEn: new Date(),
          notaResolucion: dto.nota?.trim() || null,
          metodoReembolso,
        },
      });
      if (count === 0) throw new ConflictException('La solicitud ya no está pendiente');
      if (metodoReembolso === 'efectivo') {
        await registrarSalidaEfectivo(tx, {
          concepto: 'reembolso_devolucion',
          monto: row.monto ?? 0,
          registradoPorId: resueltoPorId,
          devolucionId: id,
        });
      }
      const data = await tx.devolucion.findUnique({ where: { id }, include: INCLUDE_LISTA });
      return { success: true, data };
    }, TX_HOLGADA);
    if (resultado.data?.tipo === 'reembolso') this.avisarReembolso(resultado.data);
    return resultado;
  }

  /**
   * Un reembolso por devolución no se suma a otro reembolso del mismo dinero: el pago del pedido no debe
   * estar reembolsado y lo aprobado por devoluciones (con este) no puede pasar del total del pedido.
   */
  private async assertCabeReembolso(
    tx: Prisma.TransactionClient,
    pedidoId: number,
    devolucionId: number,
    monto: Prisma.Decimal | null,
  ) {
    await bloquearReembolsosDelPedido(tx, pedidoId);
    const pagoReembolsado = await tx.pago.findFirst({ where: { pedidoId, estado: 'reembolsado' }, select: { id: true } });
    if (pagoReembolsado) throw new ConflictException('El pago del pedido ya se reembolsó');
    const pedido = await tx.pedido.findUnique({ where: { id: pedidoId }, select: { total: true } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    const aprobado = await tx.devolucion.aggregate({
      where: { pedidoId, estado: 'aprobada', tipo: 'reembolso', id: { not: devolucionId } },
      _sum: { monto: true },
    });
    const totalReembolsado = new Prisma.Decimal(aprobado._sum.monto ?? 0).plus(monto ?? 0);
    if (totalReembolsado.gt(pedido.total)) {
      throw new ConflictException('Los reembolsos aprobados superarían el total del pedido');
    }
  }

  async rechazar(id: number, resueltoPorId: string, dto: RechazarDevolucionDto) {
    const row = await this.prisma.devolucion.findUnique({ where: { id }, select: { id: true, origen: true, pedido: { select: { estado: true } } } });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    if (row.origen === ORIGEN_REVOCACION && row.pedido?.estado === EstadoPedido.cancelado) {
      throw new ConflictException(MENSAJE_REVOCACION_POR_REINTEGRAR);
    }
    const { count } = await this.prisma.devolucion.updateMany({
      where: { id, estado: 'pendiente' },
      data: { estado: 'rechazada', resueltoPorId, resueltoEn: new Date(), notaResolucion: dto.nota?.trim() || null },
    });
    if (count === 0) throw new ConflictException('La solicitud ya no está pendiente');
    const data = await this.prisma.devolucion.findUnique({ where: { id }, include: INCLUDE_LISTA });
    return { success: true, data };
  }

  /**
   * "Recibir producto y reembolsar" una revocación de compra (devoluciones:gestionar): se reintegra el total por
   * el método original y, si el pedido se había entregado, el producto recibido regresa al stock. Si Mercado
   * Pago falla responde 503 y nada cambia, así que se puede reintentar.
   */
  async recibirRevocacion(id: number, quienId: string, dto: RecibirRevocacionDto) {
    const { reembolso, aplicada } = await this.completarRevocacion(id, quienId, { nota: dto.nota });
    const data = await this.prisma.devolucion.findUnique({ where: { id }, include: INCLUDE_LISTA });
    if (aplicada) this.avisarReembolso(data);
    return { success: true, data, reembolso };
  }

  /**
   * Único camino del dinero de una revocación (art. 56 LFPC). En una transacción con el candado de reembolsos
   * del pedido: la devolución pasa de pendiente a aprobada una sola vez (updateMany condicional), se reembolsa
   * el pago aprobado (Mercado Pago con su clave por pago; efectivo del salón con salida de la caja de quien
   * recibe) y el stock regresa solo si el producto estaba con la clienta (entregado o el heredado 'enviado'; si
   * no, regresó al cancelarlo). Si lo devuelto cubre el pago completo, el pago queda reembolsado.
   * Con `soloMercadoPago` (la revocación automática de la clienta) no hace nada si el pago no es en línea:
   * el efectivo lo entrega el personal.
   */
  async completarRevocacion(
    id: number,
    quienId: string | null,
    opciones: { nota?: string; soloMercadoPago?: boolean } = {},
  ): Promise<{ reembolso: ReembolsoRevocacion; aplicada: boolean }> {
    const fila = await this.prisma.devolucion.findUnique({ where: { id }, select: { id: true, pedidoId: true, origen: true } });
    if (!fila) throw new NotFoundException('Devolución no encontrada');
    if (fila.origen !== ORIGEN_REVOCACION) throw new BadRequestException('Esta solicitud no es una revocación de compra');
    const { pedidoId } = fila;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await bloquearReembolsosDelPedido(tx, pedidoId);
        // Leída después del candado: si otra petición ya la procesó, aquí se ve.
        const dev = await tx.devolucion.findUnique({ where: { id }, select: { estado: true, monto: true } });
        if (dev?.estado !== 'pendiente') throw new ConflictException(MENSAJE_REVOCACION_PROCESADA);
        const pedido = await tx.pedido.findUnique({
          where: { id: pedidoId },
          select: { estado: true, items: { select: { id: true, presentacionId: true, cantidad: true } } },
        });
        if (!pedido) throw new NotFoundException('Pedido no encontrado');
        const pagos = await tx.pago.findMany({
          where: { pedidoId, estado: { in: [EstadoPago.aprobado, EstadoPago.reembolsado] } },
          orderBy: { id: 'desc' },
        });
        const pago = pagos.find((p) => p.estado === EstadoPago.aprobado) ?? null;
        // Solo el saldo (ya hubo reembolsos parciales): el cliente de Mercado Pago reembolsa el pago completo,
        // así que ese saldo lo reintegra el personal a mano por el mismo medio.
        const soloSaldo = !!pago && dev.monto != null && new Prisma.Decimal(dev.monto).lt(pago.monto);
        const viaMp = !!pago && pago.proveedor === PROVEEDOR_MERCADOPAGO && !!pago.referenciaExterna && !soloSaldo;
        const efectivo = !!pago && esCobroEnEfectivoDelSalon(pago);
        const reembolso: ReembolsoRevocacion = viaMp ? 'mercado_pago' : efectivo ? 'efectivo' : !pago && pagos.length > 0 ? 'ya_reembolsado' : 'manual';
        if (opciones.soloMercadoPago && !viaMp) return { reembolso, aplicada: false };
        if (efectivo && !quienId) throw new BadRequestException('El reembolso en efectivo lo registra quien entrega el dinero');

        if (viaMp) await reembolsarEnMercadoPago(this.mercadoPago, pago.referenciaExterna!, `reembolso-pedido-${pago.id}`);

        const ahora = new Date();
        const { count } = await tx.devolucion.updateMany({
          where: { id, estado: 'pendiente' },
          data: {
            estado: 'aprobada',
            resueltoPorId: quienId,
            resueltoEn: ahora,
            notaResolucion: opciones.nota?.trim() || null,
            metodoReembolso: efectivo ? 'efectivo' : 'metodo_original',
          },
        });
        if (count !== 1) throw new ConflictException(MENSAJE_REVOCACION_PROCESADA);
        // Ya con esta revocación aprobada: lo devuelto por devoluciones de reembolso y qué artículos regresaron.
        const devueltos = await reembolsosAprobadosDelPedido(tx, pedidoId);
        // Entregado (o el heredado 'enviado'): el producto estaba con la clienta y regresa al stock al recibirlo.
        if (productoConClienta(pedido.estado)) {
          // Los artículos que ya regresó con un reembolso aprobado no se suman otra vez.
          await incrementarStockPorLineas(tx, pedido.items.filter((i) => !devueltos.articulos.has(i.id)), {
            usuarioId: quienId ?? undefined,
            referenciaTipo: 'devolucion',
            referenciaId: String(id),
            motivo: 'revocacion_compra',
          });
        }
        // El pago queda reembolsado si lo devolvió Mercado Pago o si lo devuelto (en efectivo o a mano) ya cubre
        // el pago completo: así los reportes de ingresos no cuentan dinero devuelto.
        if (pago && (viaMp || devueltos.monto.gte(pago.monto))) {
          await tx.pago.updateMany({
            where: { id: pago.id, estado: EstadoPago.aprobado },
            data: { estado: EstadoPago.reembolsado, reembolsadoEn: ahora, errorMensaje: 'Reembolsado por revocación de compra (art. 56 LFPC)' },
          });
        }
        if (efectivo) {
          await registrarSalidaEfectivo(tx, {
            concepto: 'reembolso_devolucion',
            // Nunca más de lo cobrado.
            monto: Prisma.Decimal.min(dev.monto ?? pago.monto, pago.monto),
            registradoPorId: quienId!,
            devolucionId: id,
            motivo: `Revocación de compra del pedido ${pedidoId}`,
          });
        }
        return { reembolso, aplicada: true };
      }, TX_REEMBOLSO_MP);
    } catch (e) {
      // Dos salidas de caja por la misma devolución: la llave única (devolucion_id) rechaza la segunda.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(MENSAJE_REVOCACION_PROCESADA);
      throw e;
    }
  }

  /**
   * Solo admin (RolesGuard en el controlador). Una aprobada no se borra: su salida de caja quedaría huérfana
   * y su monto dejaría de contar en el tope de reembolsos del pedido.
   */
  async eliminar(id: number) {
    const MENSAJE_APROBADA = 'Una devolución aprobada no se puede borrar';
    const row = await this.prisma.devolucion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    if (row.estado === 'aprobada') throw new ConflictException(MENSAJE_APROBADA);
    // Condicionado al estado: si la aprueban en paralelo, no se borra.
    const { count } = await this.prisma.devolucion.deleteMany({ where: { id, estado: { not: 'aprobada' } } });
    if (count === 0) throw new ConflictException(MENSAJE_APROBADA);
    return { success: true, message: 'Devolución eliminada' };
  }
}
