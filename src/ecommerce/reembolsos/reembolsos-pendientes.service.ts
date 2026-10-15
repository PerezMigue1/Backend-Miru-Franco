import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EstadoPago } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadoPagoClient } from '../mercadopago/mercadopago.client';
import { bloquearReembolsosDelPedido } from '../devoluciones/devoluciones.service';
import { EVENTO_REEMBOLSO_REALIZADO, type ReembolsoRealizadoEvent } from '../../notificaciones/eventos';

export const PERMISO_REEMBOLSOS = 'reembolsos:gestionar';
const PROVEEDOR_MERCADOPAGO = 'mercadopago';
const MENSAJE_CON_DEVOLUCIONES = 'Este pedido ya tiene reembolsos por devolución aprobados: revísalo desde Devoluciones antes de devolver este pago.';

/**
 * Admin > Reembolsos pendientes: pagos en revisión (dinero recibido que hay que devolver o revisar, como un
 * reembolso automático que falló: "reembolsar a mano"). Reintentar usa la misma clave de idempotencia que el
 * primer intento, así Mercado Pago no reembolsa dos veces; el reembolso manual exige la referencia. Cada acción
 * queda en historial_reembolsos (solo inserción).
 */
@Injectable()
export class ReembolsosPendientesService {
  private readonly logger = new Logger(ReembolsosPendientesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoClient,
    @Optional() private readonly eventos?: EventEmitter2,
  ) {}

  async listar() {
    const pagos = await this.prisma.pago.findMany({
      where: { estado: EstadoPago.en_revision },
      orderBy: { id: 'asc' },
      include: {
        pedido: { select: { id: true, estado: true, usuario: { select: { nombre: true } } } },
        cita: { select: { id: true, estado: true, cliente: { select: { nombre: true } }, servicio: { select: { nombre: true } } } },
        historialReembolsos: { orderBy: { id: 'desc' }, include: { usuario: { select: { nombre: true } } } },
      },
    });
    return {
      data: pagos.map((p) => ({
        id: p.id,
        pedidoId: p.pedidoId,
        citaId: p.citaId,
        monto: Number(p.monto),
        moneda: p.moneda,
        metodo: p.metodo,
        proveedor: p.proveedor,
        referenciaExterna: p.referenciaExterna,
        pagadoEn: p.pagadoEn,
        motivo: p.errorMensaje ?? 'Pago recibido que no se pudo aplicar (el pedido o la cita ya no lo esperaba, o el monto no coincide)',
        clienta: p.pedido?.usuario?.nombre ?? p.cita?.cliente?.nombre ?? null,
        estadoPedido: p.pedido?.estado ?? null,
        estadoCita: p.cita?.estado ?? null,
        servicio: p.cita?.servicio?.nombre ?? null,
        puedeReintentar: p.proveedor === PROVEEDOR_MERCADOPAGO && Boolean(p.referenciaExterna),
        historial: (p.historialReembolsos ?? []).map((h) => ({
          accion: h.accion,
          referencia: h.referencia,
          nota: h.nota,
          creadoEn: h.creadoEn,
          usuario: h.usuario?.nombre ?? null,
        })),
      })),
    };
  }

  private async pagoEnRevision(pagoId: number) {
    const pago = await this.prisma.pago.findUnique({
      where: { id: pagoId },
      include: { pedido: { select: { usuarioId: true } }, cita: { select: { clienteId: true } } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    if (pago.estado !== EstadoPago.en_revision) throw new ConflictException('Este pago ya no está pendiente de reembolso');
    if (pago.pedidoId !== null && (await this.prisma.devolucion.count({ where: { pedidoId: pago.pedidoId, estado: 'aprobada', tipo: 'reembolso' } })) > 0) {
      throw new ConflictException(MENSAJE_CON_DEVOLUCIONES);
    }
    return pago;
  }

  /** Reintenta el reembolso total en Mercado Pago (misma clave que el primer intento). */
  async reintentar(pagoId: number, usuarioId: string) {
    const pago = await this.pagoEnRevision(pagoId);
    if (pago.proveedor !== PROVEEDOR_MERCADOPAGO || !pago.referenciaExterna) {
      throw new ConflictException('Este pago no se hizo con Mercado Pago: márcalo como reembolsado manualmente con su referencia');
    }
    const clave = pago.pedidoId ? `reembolso-pedido-${pago.id}` : `reembolso-pago-${pago.id}`;
    let referencia: string | null = null;
    try {
      const r = await this.mercadoPago.reembolsarPago(pago.referenciaExterna, clave);
      // Solo un reembolso aprobado devolvió el dinero; rechazado, pendiente o en proceso no se marca como hecho.
      if (r?.status !== 'approved') throw new Error(`reembolso en estado ${r?.status ?? 'desconocido'}`);
      referencia = r.id != null ? String(r.id) : null;
    } catch (e) {
      // Si ya estaba reembolsado (desde el panel de Mercado Pago o un intento anterior), cuenta como hecho.
      const enMp = await this.mercadoPago.obtenerPago(pago.referenciaExterna).catch(() => null);
      if (enMp?.status !== 'refunded') {
        this.logger.warn(`No se pudo reintentar el reembolso del pago ${pago.id} (${e instanceof Error ? e.message : e})`);
        await this.prisma.historialReembolso.create({
          data: { pagoId: pago.id, accion: 'reintento_fallido', nota: 'Mercado Pago no hizo el reembolso', usuarioId },
        });
        throw new BadGatewayException(
          'Mercado Pago no pudo hacer el reembolso. Intenta de nuevo en unos minutos o, si ya lo devolviste por otro medio, márcalo como reembolsado manualmente.',
        );
      }
    }
    const r = await this.marcarReembolsado(pago, { accion: 'reintento', referencia, nota: 'Reembolsado desde Reembolsos pendientes', usuarioId });
    this.avisarClienta(pago);
    return r;
  }

  /** El salón devolvió el dinero por otro medio (transferencia, efectivo o el panel de Mercado Pago). */
  async marcarManual(pagoId: number, datos: { referencia?: string; nota?: string }, usuarioId: string) {
    const referencia = (datos.referencia ?? '').trim();
    if (!referencia) throw new BadRequestException('Escribe la referencia del reembolso (folio de la transferencia o del reembolso).');
    const pago = await this.pagoEnRevision(pagoId);
    const r = await this.marcarReembolsado(pago, { accion: 'manual', referencia, nota: (datos.nota ?? '').trim() || null, usuarioId });
    this.avisarClienta(pago);
    return r;
  }

  /** Aviso a la clienta (campana y navegador): su dinero ya se devolvió. */
  private avisarClienta(pago: { id: number; monto: unknown; pedidoId: number | null; citaId: number | null; pedido?: { usuarioId: string | null } | null; cita?: { clienteId: string | null } | null }) {
    const evento: ReembolsoRealizadoEvent = {
      usuarioId: pago.pedido?.usuarioId ?? pago.cita?.clienteId ?? null,
      entidadTipo: pago.pedidoId ? 'pedido' : 'cita',
      entidadId: (pago.pedidoId ?? pago.citaId) as number,
      monto: Number(pago.monto),
      referencia: `pago-${pago.id}`,
    };
    this.eventos?.emit(EVENTO_REEMBOLSO_REALIZADO, evento);
  }

  private async marcarReembolsado(
    pago: { id: number; pedidoId: number | null },
    h: { accion: 'reintento' | 'manual'; referencia: string | null; nota: string | null; usuarioId: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pagoId = pago.id;
      // Candado por pago: dos clics a la vez no lo registran dos veces. Con pedido, además el mismo candado que
      // devoluciones y pagos, y se vuelve a revisar que no haya reembolsos por devolución aprobados.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reembolso-pendiente:${pagoId}`}))`;
      if (pago.pedidoId !== null) {
        await bloquearReembolsosDelPedido(tx, pago.pedidoId);
        if ((await tx.devolucion.count({ where: { pedidoId: pago.pedidoId, estado: 'aprobada', tipo: 'reembolso' } })) > 0) {
          throw new ConflictException(MENSAJE_CON_DEVOLUCIONES);
        }
      }
      const marcado = await tx.pago.updateMany({
        where: { id: pagoId, estado: EstadoPago.en_revision },
        data: {
          estado: EstadoPago.reembolsado,
          reembolsadoEn: new Date(),
          errorMensaje: h.accion === 'manual' ? 'Reembolsado manualmente desde Reembolsos pendientes' : 'Reembolsado desde Reembolsos pendientes',
        },
      });
      if (marcado.count !== 1) throw new ConflictException('Este pago ya no está pendiente de reembolso');
      await tx.historialReembolso.create({
        data: { pagoId, accion: h.accion, referencia: h.referencia, nota: h.nota, usuarioId: h.usuarioId },
      });
      return { pagoId, estado: EstadoPago.reembolsado };
    });
  }
}
