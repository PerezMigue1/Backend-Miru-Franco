import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { registrarSalidaEfectivo, TX_HOLGADA } from '../../pos/salidas-caja';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { AprobarDevolucionDto, RechazarDevolucionDto } from './dto/resolver-devolucion.dto';
import { CAUSAS_POR_TIPO, motivoConPolitica, validarPoliticaDevolucion } from './politica-devolucion';

/** Resolver solicitudes ajenas (crear desde el panel, aprobar, rechazar, ver todas). Admin la tiene con '*'. */
export const PERMISO_GESTIONAR_DEVOLUCIONES = 'devoluciones:gestionar';

export const ESTADOS_DEVOLUCION = ['pendiente', 'aprobada', 'rechazada', 'cancelada'] as const;

/** Solicitudes que todavía comprometen dinero o producto: bloquean otra sobre lo mismo. */
const ESTADOS_ACTIVOS = ['pendiente', 'aprobada'];

/**
 * Serializa, dentro de la transacción, lo que mueve dinero de un pedido (crear o aprobar devoluciones y
 * reembolsar sus pagos), para que dos peticiones simultáneas no pasen las mismas comprobaciones.
 */
export async function bloquearReembolsosDelPedido(tx: Prisma.TransactionClient, pedidoId: number) {
  const clave = `reembolsos-pedido:${pedidoId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
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

@Injectable()
export class DevolucionesService {
  constructor(private readonly prisma: PrismaService) {}

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
      select: { id: true, pedido: { select: { usuarioId: true } } },
    });
    if (!row || row.pedido.usuarioId !== solicitanteId) throw new NotFoundException('Devolución no encontrada');
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
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.devolucion.findUnique({ where: { id }, select: { id: true, tipo: true, monto: true, pedidoId: true } });
      if (!row) throw new NotFoundException('Devolución no encontrada');
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
    const row = await this.prisma.devolucion.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    const { count } = await this.prisma.devolucion.updateMany({
      where: { id, estado: 'pendiente' },
      data: { estado: 'rechazada', resueltoPorId, resueltoEn: new Date(), notaResolucion: dto.nota?.trim() || null },
    });
    if (count === 0) throw new ConflictException('La solicitud ya no está pendiente');
    const data = await this.prisma.devolucion.findUnique({ where: { id }, include: INCLUDE_LISTA });
    return { success: true, data };
  }

  /** Solo admin (RolesGuard en el controlador). */
  async eliminar(id: number) {
    const row = await this.prisma.devolucion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    await this.prisma.devolucion.delete({ where: { id } });
    return { success: true, message: 'Devolución eliminada' };
  }
}
