import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { EstadoPedido } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { esDiaValido, inicioDiaMexico } from '../../common/utils/zona-mexico';
import { incrementarStockPorLineas } from '../common/pedido-inventario.util';
import { METODO_PAGO_EN_SALON, METODO_PAGO_MERCADOPAGO, VIGENCIA_PEDIDO_EN_LINEA_MS } from './flujo-pedido';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Apartado (pago al recoger) que nadie preparó: se cancela a los 3 días. */
const DIAS_APARTADO_SIN_PREPARAR = 3;
/** Listo para recoger: recordatorio al día 3 y cancelación al día 7. */
const DIAS_RECORDATORIO_RECOGER = 3;
const DIAS_CANCELAR_NO_RECOGIDO = 7;
const LOTE = 50;
export const TIPO_RECORDATORIO_RECOGER = 'pedido_recordatorio_recoger';

export type MotivoVencido = 'apartado_sin_preparar' | 'no_recogido' | 'pago_en_linea_vencido';

/**
 * Apartados y pedidos en línea vencidos. Corre con cada tick de la barrida existente (BarridoService
 * emite 'barrido.tick'). Solo toca pedidos creados desde APARTADOS_DESDE: sin esa variable no corre,
 * para que los pedidos de prueba anteriores nunca se cancelen solos.
 */
@Injectable()
export class ApartadosService {
  private readonly logger = new Logger(ApartadosService.name);
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** APARTADOS_DESDE: 'YYYY-MM-DD' (inicio de ese día en México) o fecha ISO completa. */
  private desde(): Date | null {
    const valor = (process.env.APARTADOS_DESDE ?? '').trim();
    if (!valor) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return esDiaValido(valor) ? inicioDiaMexico(valor) : null;
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  @OnEvent('barrido.tick')
  async alBarrer(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.barrer();
    } catch (e) {
      this.logger.error('Falló la barrida de apartados vencidos', e);
    } finally {
      this.corriendo = false;
    }
  }

  async barrer(ahora: Date = new Date()): Promise<{ desactivada: true } | { cancelados: number[]; recordatorios: number[] }> {
    const desde = this.desde();
    if (!desde) return { desactivada: true };
    const cancelados: number[] = [];
    const recordatorios: number[] = [];
    const antesDe = (ms: number) => ({ gte: desde, lte: new Date(ahora.getTime() - ms) });

    const apartados = await this.prisma.pedido.findMany({
      where: { metodoPago: METODO_PAGO_EN_SALON, estado: EstadoPedido.pendiente_pago, creadoEn: antesDe(DIAS_APARTADO_SIN_PREPARAR * DIA_MS) },
      select: { id: true, usuarioId: true },
      orderBy: { creadoEn: 'asc' },
      take: LOTE,
    });
    for (const p of apartados) {
      if (await this.cancelar(p.id, p.usuarioId, EstadoPedido.pendiente_pago, 'apartado_sin_preparar')) cancelados.push(p.id);
    }

    const enLinea = await this.prisma.pedido.findMany({
      where: { metodoPago: METODO_PAGO_MERCADOPAGO, estado: EstadoPedido.pendiente_pago, creadoEn: antesDe(VIGENCIA_PEDIDO_EN_LINEA_MS) },
      select: { id: true, usuarioId: true },
      orderBy: { creadoEn: 'asc' },
      take: LOTE,
    });
    for (const p of enLinea) {
      if (await this.cancelar(p.id, p.usuarioId, EstadoPedido.pendiente_pago, 'pago_en_linea_vencido')) cancelados.push(p.id);
    }

    const listos = await this.prisma.pedido.findMany({
      where: { metodoPago: METODO_PAGO_EN_SALON, estado: EstadoPedido.listo_recoger, creadoEn: { gte: desde } },
      select: {
        id: true,
        usuarioId: true,
        creadoEn: true,
        historialEstado: {
          where: { estadoNuevo: EstadoPedido.listo_recoger },
          orderBy: { creadoEn: 'desc' },
          take: 1,
          select: { creadoEn: true },
        },
      },
      orderBy: { creadoEn: 'asc' },
      take: LOTE,
    });
    for (const p of listos) {
      const listoDesde = p.historialEstado[0]?.creadoEn ?? p.creadoEn;
      const dias = (ahora.getTime() - new Date(listoDesde).getTime()) / DIA_MS;
      if (dias >= DIAS_CANCELAR_NO_RECOGIDO) {
        if (await this.cancelar(p.id, p.usuarioId, EstadoPedido.listo_recoger, 'no_recogido')) cancelados.push(p.id);
      } else if (dias >= DIAS_RECORDATORIO_RECOGER) {
        const yaAvisado = await this.prisma.notificacion.findFirst({
          where: { entidadTipo: 'pedido', entidadId: String(p.id), tipo: TIPO_RECORDATORIO_RECOGER },
          select: { id: true },
        });
        if (!yaAvisado) {
          this.eventEmitter.emit('pedido.recordatorio_recoger', { pedidoId: p.id, usuarioId: p.usuarioId });
          recordatorios.push(p.id);
        }
      }
    }
    return { cancelados, recordatorios };
  }

  /**
   * Cancela solo si el pedido sigue en `esperado` (comprobado dentro de la transacción con un update
   * condicional): si alguien lo pagó, preparó o entregó un instante antes, no se toca.
   */
  private async cancelar(pedidoId: number, usuarioId: string, esperado: EstadoPedido, motivo: MotivoVencido): Promise<boolean> {
    const cancelado = await this.prisma.$transaction(async (tx) => {
      const r = await tx.pedido.updateMany({ where: { id: pedidoId, estado: esperado }, data: { estado: EstadoPedido.cancelado } });
      if (r.count !== 1) return false;
      const items = await tx.pedidoItem.findMany({ where: { pedidoId }, select: { presentacionId: true, cantidad: true } });
      await incrementarStockPorLineas(tx, items, {
        referenciaTipo: 'pedido',
        referenciaId: String(pedidoId),
        motivo: motivo === 'pago_en_linea_vencido' ? 'pago_en_linea_vencido' : 'apartado_vencido',
      });
      await tx.historialEstadoPedido.create({
        data: {
          pedidoId,
          estadoAnterior: esperado,
          estadoNuevo: EstadoPedido.cancelado,
          origen: motivo === 'pago_en_linea_vencido' ? 'sistema.pago_en_linea_vencido' : 'sistema.apartado_vencido',
        },
      });
      return true;
    });
    if (cancelado) this.eventEmitter.emit('pedido.vencido', { pedidoId, usuarioId, motivo });
    return cancelado;
  }
}
