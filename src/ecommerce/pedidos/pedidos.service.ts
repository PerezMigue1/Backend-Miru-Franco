import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EstadoPago, EstadoPedido, Pago, Pedido, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TX_HOLGADA } from '../../pos/salidas-caja';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { MercadoPagoClient } from '../mercadopago/mercadopago.client';
import {
  bloquearReembolsosDelPedido,
  DevolucionesService,
  ESTADOS_ACTIVOS,
  saldoRevocable,
} from '../devoluciones/devoluciones.service';
import { mensajePlazoRevocacionTerminado, ORIGEN_REVOCACION, plazoRevocacion, productoConClienta } from './revocacion';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { UpdatePedidoDto } from './dto/update-pedido.dto';
import { PedidoItemLineDto } from './dto/pedido-item-line.dto';
import { precioPresentacionANumero } from '../../common/utils/money.util';
import { containsSQLInjection, sanitizeInput } from '../../common/utils/security.util';
import { normalizarRangoFechas } from '../../common/utils/fecha-rango.util';
import {
  cantidadPorPresentacion,
  decrementarStockPresentaciones,
  incrementarStockPorLineas,
} from '../common/pedido-inventario.util';
import {
  puedeEntregarPedidos,
  puedeGestionarPedidos,
  puedeVerPedidosDeOtros,
} from '../common/permisos-pedido.util';
import {
  ESTADOS_CANCELABLES_POR_CLIENTA,
  ESTADOS_INICIALES_CLIENTA,
  ESTADOS_INICIALES_PERSONAL,
  MENSAJE_SIN_ENVIO,
  METODO_PAGO_MERCADOPAGO,
  METODOS_PAGO_CLIENTA,
  esPagoEnSalon,
  transicionPermitida,
  METODOS_COBRO_SALON,
  MetodoCobroSalon,
} from './flujo-pedido';

/** Mismo proveedor con el que el webhook registra el pago aprobado (pagos-en-linea.service.ts). */
const PROVEEDOR_MERCADOPAGO = 'mercadopago';

/** Qué pasó con el dinero cuando la clienta cancela un pedido ya pagado (lo leen la web y la app). */
export type EstadoReembolsoCancelacion = 'reembolsado' | 'en_revision';

/** Resultado de revocar una compra: reembolsada, por reembolsar por el personal, o falta entregar el producto. */
export type EstadoRevocacion = EstadoReembolsoCancelacion | 'pendiente_entrega';

const MENSAJE_YA_REVOCADA = 'Ya revocaste esta compra.';

/** Motivo de la devolución de una revocación: la etiqueta legible y, si la dio, lo que escribió la clienta. */
function motivoRevocacion(motivo?: string | null): string {
  const prefijo = '[Revocación de compra · art. 56 LFPC]';
  const texto = (motivo ?? '').trim();
  return texto ? `${prefijo} ${texto}` : prefijo;
}

/** Lo que agrega el detalle del portal para el plazo de revocación (sale de la misma consulta del pedido). */
type ExtraRevocacion = { historialEstado?: { estadoNuevo: EstadoPedido; creadoEn: Date }[]; devoluciones?: { id: number }[] };

/** Datos del plazo de revocación: la primera entrega (o el primer 'enviado' heredado) del historial, si hay. */
function datosPlazo(pedido: { estado: EstadoPedido; pagadoEn: Date | null }, historial: ExtraRevocacion['historialEstado'], yaRevocado: boolean) {
  const primera = (estado: EstadoPedido) => historial?.find((h) => h.estadoNuevo === estado)?.creadoEn ?? null;
  return {
    estado: pedido.estado,
    pagadoEn: pedido.pagadoEn,
    entregadoEn: primera(EstadoPedido.entregado),
    enviadoEn: primera(EstadoPedido.enviado),
    yaRevocado,
  };
}

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
    private readonly eventEmitter: EventEmitter2,
    private readonly mercadoPago: MercadoPagoClient,
    // Opcional: solo lo usa la revocación de compra (el reembolso de una revocación vive en devoluciones).
    @Optional() private readonly devoluciones?: DevolucionesService,
  ) {}

  private includeDefault(): Prisma.PedidoInclude {
    return {
      items: { include: { producto: true, presentacion: true } },
      direccionEnvio: true,
      usuario: { select: { id: true, nombre: true, email: true } },
    };
  }

  /** Además, la entrega o el envío heredado (historial) y si ya tiene una revocación activa: para el plazo del art. 56. */
  private includeRevocacion(): Prisma.PedidoInclude {
    return {
      ...this.includeDefault(),
      historialEstado: {
        where: { estadoNuevo: { in: [EstadoPedido.entregado, EstadoPedido.enviado] } },
        select: { estadoNuevo: true, creadoEn: true },
        orderBy: { creadoEn: 'asc' },
      },
      devoluciones: { where: { origen: ORIGEN_REVOCACION, estado: { in: ESTADOS_ACTIVOS } }, select: { id: true }, take: 1 },
    };
  }

  async listar(
    solicitanteId: string,
    filtros?: {
      usuarioId?: string;
      estado?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      metodoPago?: string;
      q?: string;
      sort?: string;
      page?: number;
      limit?: number;
      /** Portal de clienta: solo los pedidos de quien consulta, sea del rol que sea. */
      propios?: boolean;
    },
  ) {
    const rol = await this.access.getRol(solicitanteId);
    const puedeVerOtros = !filtros?.propios && (await puedeVerPedidosDeOtros(this.prisma, rol));
    const {
      usuarioId: filtroUsuarioId,
      estado,
      fechaDesde,
      fechaHasta,
      metodoPago,
      q,
      sort,
      page = 1,
      limit = 20,
    } = filtros ?? {};
    const where: Prisma.PedidoWhereInput = {};

    if (filtros?.propios) {
      where.usuarioId = solicitanteId;
    } else if (filtroUsuarioId) {
      if (!puedeVerOtros) {
        throw new ForbiddenException(
          'No tienes permiso para filtrar pedidos por usuarioId',
        );
      }
      where.usuarioId = filtroUsuarioId;
    } else if (!puedeVerOtros) {
      where.usuarioId = solicitanteId;
    }

    if (estado) {
      if (!Object.values(EstadoPedido).includes(estado as EstadoPedido)) {
        throw new BadRequestException(`Estado de pedido inválido: ${estado}`);
      }
      where.estado = estado as EstadoPedido;
    }

    if (metodoPago) {
      where.metodoPago = { contains: metodoPago, mode: 'insensitive' };
    }

    if (fechaDesde || fechaHasta) {
      const { gte, lte } = normalizarRangoFechas(fechaDesde, fechaHasta);
      if ((fechaDesde && !gte) || (fechaHasta && !lte)) {
        throw new BadRequestException('fechaDesde/fechaHasta deben ser fechas ISO válidas');
      }
      where.creadoEn = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    if (q && q.trim().length > 0) {
      const term = q.trim();
      const byId = Number.parseInt(term, 10);
      const orConditions: Prisma.PedidoWhereInput[] = [
        { usuario: { is: { nombre: { contains: term, mode: 'insensitive' } } } },
        { usuario: { is: { email: { contains: term, mode: 'insensitive' } } } },
        { usuario: { is: { telefono: { contains: term, mode: 'insensitive' } } } },
        { metodoPago: { contains: term, mode: 'insensitive' } },
        { referenciaPago: { contains: term, mode: 'insensitive' } },
      ];
      if (!Number.isNaN(byId)) {
        orConditions.push({ id: byId });
      }
      where.OR = orConditions;
    }

    let orderBy: Prisma.PedidoOrderByWithRelationInput = { creadoEn: 'desc' };
    if (sort) {
      const normalized = sort.trim().toLowerCase();
      if (normalized === 'creadoen:asc') {
        orderBy = { creadoEn: 'asc' };
      } else if (normalized === 'creadoen:desc') {
        orderBy = { creadoEn: 'desc' };
      } else {
        throw new BadRequestException(
          'sort inválido. Usa creadoEn:asc o creadoEn:desc',
        );
      }
    }

    const skip = (page - 1) * limit;
    const total = await this.prisma.pedido.count({ where });
    const data = await this.prisma.pedido.findMany({
      where,
      include: this.includeDefault(),
      orderBy,
      skip,
      take: limit,
    });
    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data,
    };
  }

  async obtenerPorId(id: number, solicitanteId: string, propios = false, ahora: Date = new Date()) {
    const data = await this.prisma.pedido.findUnique({
      where: { id },
      include: propios ? this.includeRevocacion() : this.includeDefault(),
    });
    if (!data) throw new NotFoundException('Pedido no encontrado');

    const esDueno = data.usuarioId === solicitanteId;
    // Portal de clienta: el pedido ajeno responde 404 para cualquier rol.
    if (propios && !esDueno) throw new NotFoundException('Pedido no encontrado');
    if (!esDueno) {
      const rol = await this.access.getRol(solicitanteId);
      const puedeVerOtros = await puedeVerPedidosDeOtros(this.prisma, rol);
      if (!puedeVerOtros) {
        throw new ForbiddenException('No tienes permiso para acceder a este recurso');
      }
    }
    if (!propios) return { success: true, data };
    // Portal: hasta cuándo puede revocar su compra (art. 56) y si hoy puede; lo auxiliar no sale en la respuesta.
    const { historialEstado, devoluciones, ...pedido } = data as typeof data & ExtraRevocacion;
    const plazo = plazoRevocacion(datosPlazo(pedido, historialEstado, (devoluciones?.length ?? 0) > 0), ahora);
    if (!plazo.revocableHasta) return { success: true, data: { ...pedido, ...plazo, montoRevocable: 0 } };
    // Mismas reglas que revocar(): una devolución en proceso o el pago ya reembolsado la bloquean, y solo
    // se reintegra el saldo (saldoRevocable: menos lo ya reembolsado y nunca más de lo cobrado).
    const [enProceso, pagoReembolsado, { saldo }] = await Promise.all([
      this.prisma.devolucion.findFirst({ where: { pedidoId: id, estado: 'pendiente' }, select: { id: true } }),
      this.prisma.pago.findFirst({ where: { pedidoId: id, estado: EstadoPago.reembolsado }, select: { id: true } }),
      saldoRevocable(this.prisma, id, pedido.total),
    ]);
    const puedeRevocar = plazo.puedeRevocar && !enProceso && !pagoReembolsado && saldo.gt(0);
    return { success: true, data: { ...pedido, revocableHasta: plazo.revocableHasta, puedeRevocar, montoRevocable: saldo.toNumber() } };
  }

  /**
   * Revocación de compra (art. 56 LFPC), solo la dueña (lo ajeno responde 404) y dentro de los 5 días hábiles.
   * - Sin entregar: se cancela el pedido, regresa el stock y se registra la devolución (origen revocacion_art56);
   *   si se pagó con Mercado Pago se reembolsa en ese momento; si no, el personal la reembolsa desde devoluciones.
   * - Entregado (o el heredado 'enviado'): queda la devolución pendiente de que la clienta entregue el producto
   *   en el salón; el plazo corre desde la entrega (o el envío) del historial y, si no hay, desde el pago.
   * Con el candado de reembolsos del pedido: dos peticiones simultáneas dejan una sola devolución.
   */
  async revocar(id: number, solicitanteId: string, motivo?: string, ahora: Date = new Date()) {
    const leido = await this.prisma.pedido.findUnique({ where: { id }, include: this.includeRevocacion() });
    if (!leido || leido.usuarioId !== solicitanteId) throw new NotFoundException('Pedido no encontrado');
    // Mismo saneamiento que los demás textos libres, antes de tocar nada.
    const motivoLimpio = motivo ? sanitizeInput(motivo) : '';
    if (motivoLimpio && containsSQLInjection(motivoLimpio)) throw new BadRequestException('El motivo contiene caracteres no permitidos');
    const { historialEstado, devoluciones: revocaciones, ...pedido } = leido as typeof leido & ExtraRevocacion;
    if ((revocaciones?.length ?? 0) > 0) throw new ConflictException(MENSAJE_YA_REVOCADA);
    if (pedido.estado === EstadoPedido.cancelado) throw new ConflictException('Este pedido está cancelado: no hay compra que revocar.');
    const { revocableHasta } = plazoRevocacion(datosPlazo(pedido, historialEstado, false), ahora);
    if (!revocableHasta) throw new ConflictException('Tu pedido todavía no está pagado: no hay pago que reintegrar.');
    if (ahora.getTime() > revocableHasta.getTime()) throw new ConflictException(mensajePlazoRevocacionTerminado(revocableHasta));

    // Entregado o el heredado 'enviado': el producto está con la clienta, se espera a que lo devuelva.
    const entregado = productoConClienta(pedido.estado);
    const items = (pedido as { items?: { id: number; presentacionId: number; cantidad: number }[] }).items ?? [];
    const devolucion = await this.prisma.$transaction(async (tx) => {
      await bloquearReembolsosDelPedido(tx, id);
      // Bloquea una devolución en proceso (pendiente) o una revocación vigente; una normal ya resuelta no.
      const activa = await tx.devolucion.findFirst({
        where: { pedidoId: id, OR: [{ estado: 'pendiente' }, { origen: ORIGEN_REVOCACION, estado: { in: ESTADOS_ACTIVOS } }] },
        select: { origen: true },
      });
      if (activa) {
        throw new ConflictException(
          activa.origen === ORIGEN_REVOCACION
            ? MENSAJE_YA_REVOCADA
            : 'Tienes una solicitud de devolución activa en este pedido: retírala o comunícate con el salón para revocar la compra.',
        );
      }
      const reembolsado = await tx.pago.findFirst({ where: { pedidoId: id, estado: EstadoPago.reembolsado }, select: { id: true } });
      if (reembolsado) throw new ConflictException('El pago de este pedido ya se reembolsó.');
      // Solo el saldo: lo pagado menos lo ya reembolsado por devoluciones aprobadas, nunca más de lo cobrado.
      const { saldo, articulos } = await saldoRevocable(tx, id, pedido.total);
      if (saldo.lte(0)) throw new ConflictException('Este pedido ya se reembolsó por completo');
      // El stock regresa solo por los artículos que la clienta no haya devuelto ya.
      const lineas = items
        .filter((i) => !articulos.has(i.id))
        .map((i) => ({ presentacionId: i.presentacionId, cantidad: i.cantidad }));
      if (!entregado) {
        // Condicional: si el salón lo movió (o lo entregó) un instante antes, no se pisa.
        const r = await tx.pedido.updateMany({ where: { id, estado: pedido.estado }, data: { estado: EstadoPedido.cancelado } });
        if (r.count !== 1) throw new ConflictException('El pedido cambió mientras lo revocabas. Recarga para ver su estado.');
        await incrementarStockPorLineas(tx, lineas, { usuarioId: solicitanteId, referenciaTipo: 'pedido', referenciaId: String(id), motivo: 'pedido_revocado' });
        await tx.historialEstadoPedido.create({
          data: { pedidoId: id, estadoAnterior: pedido.estado, estadoNuevo: EstadoPedido.cancelado, origen: 'api.revocar_clienta', usuarioId: solicitanteId },
        });
      }
      return tx.devolucion.create({
        data: {
          pedidoId: id,
          estado: 'pendiente',
          tipo: 'reembolso',
          origen: ORIGEN_REVOCACION,
          motivo: motivoRevocacion(motivoLimpio),
          monto: saldo,
        },
        select: { id: true, monto: true },
      });
    }, TX_HOLGADA);

    const monto = Number(devolucion.monto);
    let estado: EstadoRevocacion = 'pendiente_entrega';
    if (!entregado) {
      estado = await this.reembolsarRevocacionEnLinea(devolucion.id);
      const usuario = (pedido as { usuario?: { nombre?: string | null; email?: string | null } }).usuario;
      this.eventEmitter.emit('pedido.cancelado', { pedidoId: id, usuarioId: pedido.usuarioId });
      this.eventEmitter.emit('pedido.cancelado_pagado', {
        pedidoId: id,
        usuarioId: pedido.usuarioId,
        clienta: usuario?.nombre?.trim() || usuario?.email || pedido.usuarioId,
        monto,
        reembolso: estado,
      });
    } else {
      // El producto está con la clienta: se avisa a quien gestiona devoluciones que lo reciba y reembolse
      // (NotificacionesListener.onRevocacionPorRecibir). Después del commit: nunca afecta la revocación.
      this.eventEmitter.emit('pedido.revocacion_por_recibir', { pedidoId: id, usuarioId: pedido.usuarioId, devolucionId: devolucion.id, monto });
    }
    const { data } = await this.obtenerPorId(id, solicitanteId, true, ahora);
    return { success: true, data, revocacion: { estado, monto, devolucionId: devolucion.id } };
  }

  /** Reembolso inmediato de la revocación pagada en línea. Nunca lanza: si no sale, lo reembolsa el personal. */
  private async reembolsarRevocacionEnLinea(devolucionId: number): Promise<EstadoReembolsoCancelacion> {
    if (!this.devoluciones) return 'en_revision';
    try {
      const { aplicada } = await this.devoluciones.completarRevocacion(devolucionId, null, { soloMercadoPago: true });
      return aplicada ? 'reembolsado' : 'en_revision';
    } catch (e) {
      this.logger.warn(`La revocación ${devolucionId} quedó por reembolsar a mano (${e instanceof Error ? e.message : e})`);
      return 'en_revision';
    }
  }

  private async validarItems(lines: PedidoItemLineDto[]) {
    const detalles: {
      productoId: number;
      presentacionId: number;
      cantidad: number;
      precioUnitario: number;
      subtotal: number;
      nombreProducto: string | null;
      tamanio: string | null;
    }[] = [];

    for (const line of lines) {
      const pres = await this.prisma.productoPresentacion.findUnique({
        where: { id: line.presentacionId },
        include: { producto: true },
      });
      if (!pres) {
        throw new NotFoundException(
          `Presentación ${line.presentacionId} no encontrada`,
        );
      }
      // productoId canónico desde BD (el cliente puede enviar un productoId desfasado del carrito)
      const productoId = pres.productoId;
      // Producto desactivado (borrado lógico): ya no se vende.
      if (pres.producto.activo === false) {
        throw new BadRequestException(`Este producto ya no está a la venta (${pres.producto.nombre})`);
      }
      if (!pres.disponible || pres.stock < line.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente o presentación no disponible (producto ${pres.producto.nombre})`,
        );
      }
      const precioUnitario = precioPresentacionANumero(pres.precio);
      // Una presentación en $0 no se vende: crearía un pedido sin nada que cobrar.
      if (precioUnitario <= 0) {
        throw new BadRequestException(`Este producto no tiene precio válido (${pres.producto.nombre})`);
      }
      const subtotal = Math.round(precioUnitario * line.cantidad * 100) / 100;
      detalles.push({
        productoId,
        presentacionId: line.presentacionId,
        cantidad: line.cantidad,
        precioUnitario,
        subtotal,
        nombreProducto: pres.producto.nombre,
        tamanio: pres.tamanio,
      });
    }
    return detalles;
  }

  async crear(solicitanteId: string, dto: CreatePedidoDto, propios = false) {
    const rol = await this.access.getRol(solicitanteId);
    let usuarioId = solicitanteId;
    if (dto.usuarioId && dto.usuarioId !== solicitanteId) {
      // Desde el portal el pedido es siempre de quien compra, también para admin.
      if (propios || !this.access.isAdmin(rol)) {
        throw new ForbiddenException(
          'Solo un administrador puede crear pedidos para otro usuario',
        );
      }
      usuarioId = dto.usuarioId;
    }

    // Todo pedido se recoge en el salón.
    if (dto.direccionEnvioId || (dto.costoEnvio ?? 0) > 0) {
      throw new BadRequestException(MENSAJE_SIN_ENVIO);
    }

    // Desde el portal compra como clienta: mismas reglas que ella, aunque tenga caja.
    const esPersonal = !propios && (await puedeGestionarPedidos(this.prisma, rol));
    if (!esPersonal) {
      // La clienta paga en línea o al recoger: su pedido siempre nace pendiente de pago.
      if (!dto.estado || !ESTADOS_INICIALES_CLIENTA.includes(dto.estado)) {
        throw new BadRequestException(`Un pedido nuevo empieza como '${EstadoPedido.pendiente_pago}'`);
      }
      if (!dto.metodoPago || !METODOS_PAGO_CLIENTA.includes(dto.metodoPago)) {
        throw new BadRequestException(`Elige cómo pagar el pedido: ${METODOS_PAGO_CLIENTA.join(' o ')}`);
      }
    }
    const estado = dto.estado ?? EstadoPedido.borrador;
    if (esPersonal && !ESTADOS_INICIALES_PERSONAL.includes(estado)) {
      throw new BadRequestException(`Un pedido nuevo no puede empezar como '${estado}'`);
    }

    const detalles = await this.validarItems(dto.items);
    const subtotal =
      Math.round(
        detalles.reduce((s, d) => s + d.subtotal, 0) * 100,
      ) / 100;
    const costoEnvio = 0;
    const impuestos = 0;
    const descuento = 0;
    const total =
      Math.round((subtotal + costoEnvio + impuestos - descuento) * 100) / 100;

    const moneda = dto.moneda ?? 'MXN';

    const data = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          usuarioId,
          direccionEnvioId: null,
          estado,
          subtotal,
          costoEnvio,
          impuestos,
          descuento,
          total,
          moneda,
          notasCliente: dto.notasCliente ?? null,
          metodoPago: dto.metodoPago ?? null,
          // La referencia del pago en línea la pone el webhook; la clienta no la fija.
          referenciaPago: esPersonal ? dto.referenciaPago ?? null : null,
          items: {
            create: detalles.map((d) => ({
              productoId: d.productoId,
              presentacionId: d.presentacionId,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              subtotal: d.subtotal,
              nombreProducto: d.nombreProducto,
              tamanio: d.tamanio,
            })),
          },
        },
        include: this.includeDefault(),
      });

      const cantidades = cantidadPorPresentacion(
        detalles.map((d) => ({
          presentacionId: d.presentacionId,
          cantidad: d.cantidad,
        })),
      );
      await decrementarStockPresentaciones(tx, cantidades, {
        usuarioId: solicitanteId,
        referenciaTipo: 'pedido',
        referenciaId: String(pedido.id),
        motivo: 'pedido_creado',
      });

      await tx.historialEstadoPedido.create({
        data: {
          pedidoId: pedido.id,
          estadoAnterior: null,
          estadoNuevo: estado,
          origen: 'api.crear_pedido',
          usuarioId: solicitanteId,
        },
      });

      return pedido;
    });

    // Fuera de la transacción a propósito, mismo criterio que citas.service.ts:357-365
    // y pos.service.ts:240-246: el pedido ya está comprometido en BD en este punto,
    // un fallo al notificar nunca debe poder revertirlo.
    this.eventEmitter.emit('pedido.creado', {
      pedidoId: data.id,
      usuarioId: data.usuarioId,
    });

    return { success: true, data };
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdatePedidoDto,
    propios = false,
  ) {
    const actual = await this.prisma.pedido.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Pedido no encontrado');
    const usuarioIdPedido = actual.usuarioId;
    // Portal de clienta: el pedido ajeno responde 404 para cualquier rol.
    if (propios && usuarioIdPedido !== solicitanteId) throw new NotFoundException('Pedido no encontrado');

    const rol = await this.access.getRol(solicitanteId);
    // Desde el portal se actúa como clienta (solo cancelar a tiempo), aunque el rol tenga caja.
    const puedeCambiarEstado = !propios && (await puedeGestionarPedidos(this.prisma, rol));

    // Entrada al método: dueño, admin, o quien tenga caja:escritura. Qué campos puede tocar cada quien
    // se decide más abajo, campo por campo — esto solo decide quién puede intentarlo.
    if (usuarioIdPedido !== solicitanteId && !puedeCambiarEstado) {
      throw new ForbiddenException('No tienes permiso para acceder a este recurso');
    }

    // Todo pedido se recoge en el salón. Vaciar (null / '' / 0) sí se permite; los datos de
    // envío de pedidos anteriores se quedan como historial mientras nadie los toque.
    if (
      dto.direccionEnvioId ||
      dto.direccionTextoCompleta?.trim() ||
      (dto.costoEnvio ?? 0) > 0
    ) {
      throw new BadRequestException(MENSAJE_SIN_ENVIO);
    }

    const estadoAnterior = actual.estado;
    const cambiaEstado = dto.estado !== undefined && dto.estado !== estadoAnterior;
    if (cambiaEstado && !puedeCambiarEstado) {
      // La clienta solo puede cancelar su pedido, y solo antes de que se empiece a preparar.
      const cancelaATiempo =
        dto.estado === EstadoPedido.cancelado &&
        ESTADOS_CANCELABLES_POR_CLIENTA.includes(estadoAnterior);
      if (!cancelaATiempo) {
        throw new ForbiddenException(
          'Solo el personal del salón cambia el estado del pedido. Puedes cancelarlo mientras no esté en preparación.',
        );
      }
    } else if (cambiaEstado && !transicionPermitida(estadoAnterior, dto.estado!, actual.metodoPago)) {
      throw new BadRequestException(
        `No se puede pasar un pedido de '${estadoAnterior}' a '${dto.estado}'`,
      );
    } else if (
      cambiaEstado &&
      (dto.estado === EstadoPedido.listo_recoger || dto.estado === EstadoPedido.entregado) &&
      !(await puedeEntregarPedidos(this.prisma, rol))
    ) {
      // Marcar listo y entregar son del permiso propio de entregas, no de la caja.
      throw new ForbiddenException('Necesitas el permiso de entregar pedidos');
    } else if (
      cambiaEstado &&
      dto.estado === EstadoPedido.entregado &&
      esPagoEnSalon(actual.metodoPago) &&
      !actual.pagadoEn
    ) {
      // Entregar un apartado es también cobrarlo: va por POST /pedidos/:id/entregar, que registra el
      // pago con su método y quién cobró (si no, el dinero no llega al corte de caja).
      throw new BadRequestException('Para entregar un apartado usa "Cobrar y entregar": registra cómo se pagó');
    }
    // Se cobra al marcar 'pagado' o, en el pago al recoger, al entregar en el salón.
    const registraPago =
      cambiaEstado &&
      !actual.pagadoEn &&
      (dto.estado === EstadoPedido.pagado ||
        (dto.estado === EstadoPedido.entregado && esPagoEnSalon(actual.metodoPago)));
    // La clienta cancela un pedido ya pagado: más abajo se le devuelve el pago.
    const cancelaPagadoClienta =
      cambiaEstado && !puedeCambiarEstado && dto.estado === EstadoPedido.cancelado && estadoAnterior === EstadoPedido.pagado;

    const data = await this.prisma.$transaction(async (tx) => {
      if (cancelaPagadoClienta) {
        // Mismo candado que devoluciones: si ya hay una en proceso, el dinero no sale también por aquí.
        await bloquearReembolsosDelPedido(tx, id);
        const devolucion = await tx.devolucion.findFirst({
          where: { pedidoId: id, estado: { notIn: ['rechazada', 'cancelada'] } },
          select: { id: true },
        });
        if (devolucion) {
          throw new ConflictException('Este pedido tiene una devolución en proceso: para cancelarlo comunícate con el salón.');
        }
      }

      const itemsStock = await tx.pedidoItem.findMany({
        where: { pedidoId: id },
        select: { presentacionId: true, cantidad: true },
      });

      const updateData: Prisma.PedidoUpdateInput = {
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(registraPago && { pagadoEn: new Date() }),
        ...(dto.direccionEnvioId !== undefined && {
          direccionEnvio: dto.direccionEnvioId
            ? { connect: { id: dto.direccionEnvioId } }
            : { disconnect: true },
        }),
        ...(dto.direccionTextoCompleta !== undefined && {
          direccionTextoCompleta: dto.direccionTextoCompleta,
        }),
        ...(dto.notasCliente !== undefined && {
          notasCliente: dto.notasCliente,
        }),
        ...(dto.moneda !== undefined && { moneda: dto.moneda }),
        ...(dto.costoEnvio !== undefined && { costoEnvio: dto.costoEnvio }),
        ...(dto.impuestos !== undefined && { impuestos: dto.impuestos }),
        ...(dto.descuento !== undefined && { descuento: dto.descuento }),
        ...(dto.metodoPago !== undefined && { metodoPago: dto.metodoPago }),
        ...(dto.referenciaPago !== undefined && {
          referenciaPago: dto.referenciaPago,
        }),
      };

      // costoEnvio/impuestos/descuento: SOLO admin, sin cambios respecto a antes.
      if (propios || !this.access.isAdmin(rol)) {
        delete (updateData as any).costoEnvio;
        delete (updateData as any).impuestos;
        delete (updateData as any).descuento;
      }
      // metodoPago/referenciaPago: solo el personal. El método decide el flujo (pago al recoger o en
      // línea), así que la clienta no puede cambiarlo después de crear el pedido.
      if (!puedeCambiarEstado) {
        delete (updateData as any).metodoPago;
        delete (updateData as any).referenciaPago;
      }
      // estado: ya validado arriba (personal con transición válida, o la clienta cancelando a tiempo).

      const keys = Object.keys(updateData).filter(
        (k) => (updateData as any)[k] !== undefined,
      );
      if (keys.length === 0) {
        throw new BadRequestException('No hay campos permitidos para actualizar');
      }

      // El estado solo cambia si sigue siendo el que se leyó: si la barrida de apartados (u otra persona)
      // lo cambió un instante antes, no se pisa.
      if (cambiaEstado) {
        const r = await tx.pedido.updateMany({ where: { id, estado: estadoAnterior }, data: { estado: dto.estado! } });
        if (r.count !== 1) throw new ConflictException('El pedido cambió mientras lo editabas. Recarga para ver su estado.');
      }

      // cancelado es final (ya no hay reactivación), así que solo se devuelve stock al cancelar.
      if (cambiaEstado && dto.estado === EstadoPedido.cancelado) {
        await incrementarStockPorLineas(tx, itemsStock, {
          usuarioId: solicitanteId,
          referenciaTipo: 'pedido',
          referenciaId: String(id),
          motivo: 'pedido_cancelado',
        });
      }

      const updated = await tx.pedido.update({
        where: { id },
        data: updateData,
        include: this.includeDefault(),
      });

      if (cambiaEstado) {
        await tx.historialEstadoPedido.create({
          data: {
            pedidoId: id,
            estadoAnterior,
            estadoNuevo: dto.estado!,
            origen: puedeCambiarEstado ? 'api.actualizar_pedido' : 'api.cancelar_clienta',
            usuarioId: solicitanteId,
          },
        });
      }

      return updated;
    });

    // Fuera de la transacción a propósito (mismo criterio que crear(), arriba, y
    // que citas.service.ts/pos.service.ts): solo notificar el subconjunto de
    // transiciones que le importan al cliente. 'preparando' es interno y ya nadie
    // puede pasar a 'enviado' — se dejan fuera.
    if (cambiaEstado) {
      const eventoPorEstado: Partial<Record<EstadoPedido, string>> = {
        [EstadoPedido.pagado]: 'pedido.pagado',
        [EstadoPedido.listo_recoger]: 'pedido.listo_recoger',
        [EstadoPedido.entregado]: 'pedido.entregado',
        [EstadoPedido.cancelado]: 'pedido.cancelado',
      };
      const evento = eventoPorEstado[dto.estado!];
      if (evento) {
        this.eventEmitter.emit(evento, {
          pedidoId: id,
          usuarioId: usuarioIdPedido,
        });
      }
    }

    // La clienta canceló un pedido ya pagado: se le devuelve el pago y se avisa al personal. Va después de
    // confirmar la cancelación (el cambio condicional de estado asegura que solo una llega aquí).
    if (cancelaPagadoClienta) {
      const monto = Number(actual.total);
      const estadoReembolso = await this.reembolsarCancelacionClienta(actual);
      this.eventEmitter.emit('pedido.cancelado_pagado', {
        pedidoId: id,
        usuarioId: usuarioIdPedido,
        clienta: data.usuario?.nombre?.trim() || data.usuario?.email || usuarioIdPedido,
        monto,
        reembolso: estadoReembolso,
      });
      return { success: true, data, reembolso: { estado: estadoReembolso, monto } };
    }

    return { success: true, data };
  }

  /**
   * Reembolso total del pago en línea cuando la clienta cancela un pedido pagado. Nunca lanza: el pedido ya
   * quedó cancelado. Si no sale (o no hay pago de Mercado Pago que devolver), el pago queda en revisión para
   * que el personal lo reembolse a mano.
   */
  private async reembolsarCancelacionClienta(pedido: Pedido): Promise<EstadoReembolsoCancelacion> {
    // Solo el pago con Mercado Pago se devuelve solo; cualquier otro método lo revisa el personal.
    if (pedido.metodoPago !== METODO_PAGO_MERCADOPAGO) {
      this.logger.warn(`El pedido ${pedido.id} se canceló pagado con '${pedido.metodoPago}': reembolso en revisión`);
      return 'en_revision';
    }
    let pago: Pago | null = null;
    try {
      pago = await this.prisma.pago.findFirst({
        where: {
          pedidoId: pedido.id,
          estado: EstadoPago.aprobado,
          proveedor: PROVEEDOR_MERCADOPAGO,
          referenciaExterna: { not: null },
        },
        orderBy: { id: 'desc' },
      });
      if (!pago) {
        this.logger.warn(`El pedido ${pedido.id} se canceló pagado sin un pago aprobado de Mercado Pago: reembolso en revisión`);
        return 'en_revision';
      }
      try {
        // Clave por pago: si se reintenta, Mercado Pago no reembolsa dos veces.
        await this.mercadoPago.reembolsarPago(pago.referenciaExterna!, `reembolso-pedido-${pago.id}`);
      } catch (e) {
        // Si ya estaba reembolsado (desde el panel de Mercado Pago o un intento anterior), cuenta como hecho.
        const enMp = await this.mercadoPago.obtenerPago(pago.referenciaExterna!).catch(() => null);
        if (enMp?.status !== 'refunded') throw e;
      }
    } catch (e) {
      this.logger.warn(
        `No se pudo reembolsar el pago ${pago?.referenciaExterna} del pedido ${pedido.id}: queda en revisión (${e instanceof Error ? e.message : e})`,
      );
      if (pago) {
        await this.prisma.pago
          .updateMany({
            where: { id: pago.id, estado: EstadoPago.aprobado },
            data: { estado: EstadoPago.en_revision, errorMensaje: 'No se pudo reembolsar al cancelar la clienta: reembolsar a mano' },
          })
          .catch((err) => this.logger.error(`No se pudo dejar en revisión el pago ${pago!.id} del pedido ${pedido.id}`, err));
      }
      return 'en_revision';
    }
    // El dinero ya se devolvió: aunque falle el registro, para la clienta el reembolso salió.
    await this.prisma.pago
      .updateMany({
        where: { id: pago.id, estado: EstadoPago.aprobado },
        data: { estado: EstadoPago.reembolsado, reembolsadoEn: new Date(), errorMensaje: 'Reembolsado al cancelar la clienta' },
      })
      .catch((err) => this.logger.error(`El pago ${pago!.id} del pedido ${pedido.id} se reembolsó pero no se registró`, err));
    return 'reembolsado';
  }

  /** Lee el pedido y comprueba el permiso de entregas (admin o `pedidos:entregar`). */
  private async pedidoParaEntrega(id: number, solicitanteId: string) {
    const rol = await this.access.getRol(solicitanteId);
    if (!(await puedeEntregarPedidos(this.prisma, rol))) {
      throw new ForbiddenException('Necesitas el permiso de entregar pedidos');
    }
    const pedido = await this.prisma.pedido.findUnique({ where: { id } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido;
  }

  /** "Marcar listo para recoger": preparando → listo_recoger y aviso a la clienta (app y correo). */
  async marcarListo(id: number, solicitanteId: string) {
    const pedido = await this.pedidoParaEntrega(id, solicitanteId);
    if (!transicionPermitida(pedido.estado, EstadoPedido.listo_recoger, pedido.metodoPago)) {
      throw new BadRequestException('Solo se marca listo un pedido en preparación');
    }
    const data = await this.prisma.$transaction(async (tx) => {
      const r = await tx.pedido.updateMany({
        where: { id, estado: pedido.estado },
        data: { estado: EstadoPedido.listo_recoger },
      });
      if (r.count !== 1) throw new ConflictException('El pedido cambió mientras lo editabas. Recarga para ver su estado.');
      await tx.historialEstadoPedido.create({
        data: { pedidoId: id, estadoAnterior: pedido.estado, estadoNuevo: EstadoPedido.listo_recoger, origen: 'api.marcar_listo', usuarioId: solicitanteId },
      });
      return tx.pedido.findUnique({ where: { id }, include: this.includeDefault() });
    });
    this.eventEmitter.emit('pedido.listo_recoger', { pedidoId: id, usuarioId: pedido.usuarioId });
    return { success: true, data };
  }

  /**
   * "Marcar entregado" o "Cobrar y entregar": listo_recoger (o el 'enviado' de pedidos anteriores) →
   * entregado. Un apartado (pago al recoger) exige el método de cobro, y en la misma transacción se
   * registra el Pago aprobado con quién cobró, para el corte de caja.
   */
  async entregar(id: number, solicitanteId: string, metodoCobro?: MetodoCobroSalon) {
    const pedido = await this.pedidoParaEntrega(id, solicitanteId);
    if (!transicionPermitida(pedido.estado, EstadoPedido.entregado, pedido.metodoPago)) {
      throw new BadRequestException('Solo se entrega un pedido listo para recoger');
    }
    const cobra = esPagoEnSalon(pedido.metodoPago) && !pedido.pagadoEn;
    if (cobra && !METODOS_COBRO_SALON.includes(metodoCobro as MetodoCobroSalon)) {
      throw new BadRequestException('Indica cómo se cobró: efectivo, tarjeta en terminal o transferencia');
    }
    const ahora = new Date();
    const data = await this.prisma.$transaction(async (tx) => {
      const r = await tx.pedido.updateMany({
        where: { id, estado: pedido.estado },
        data: { estado: EstadoPedido.entregado, ...(cobra && { pagadoEn: ahora }) },
      });
      if (r.count !== 1) throw new ConflictException('El pedido cambió mientras lo editabas. Recarga para ver su estado.');
      if (cobra) {
        await tx.pago.create({
          data: {
            pedidoId: id,
            intentoNumero: 1,
            monto: Number(pedido.total),
            moneda: pedido.moneda ?? 'MXN',
            metodo: metodoCobro!,
            estado: 'aprobado',
            pagadoEn: ahora,
            cobradoPorId: solicitanteId,
          },
        });
      }
      await tx.historialEstadoPedido.create({
        data: { pedidoId: id, estadoAnterior: pedido.estado, estadoNuevo: EstadoPedido.entregado, origen: cobra ? 'api.cobrar_entregar' : 'api.entregar', usuarioId: solicitanteId },
      });
      return tx.pedido.findUnique({ where: { id }, include: this.includeDefault() });
    });
    this.eventEmitter.emit('pedido.entregado', { pedidoId: id, usuarioId: pedido.usuarioId });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const rol = await this.access.getRol(solicitanteId);
    if (!this.access.isAdmin(rol)) {
      throw new ForbiddenException('Solo administradores pueden eliminar pedidos');
    }
    await this.access.assertPedido(solicitanteId, id);
    const pedidoRow = await this.prisma.pedido.findUnique({
      where: { id },
      select: { estado: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const itemsStock = await tx.pedidoItem.findMany({
        where: { pedidoId: id },
        select: { presentacionId: true, cantidad: true },
      });
      if (pedidoRow?.estado !== EstadoPedido.cancelado) {
        await incrementarStockPorLineas(tx, itemsStock, {
          usuarioId: solicitanteId,
          referenciaTipo: 'pedido',
          referenciaId: String(id),
          motivo: 'pedido_eliminado',
        });
      }
      await tx.pedido.delete({ where: { id } });
    });
    return { success: true, message: 'Pedido eliminado' };
  }
}
