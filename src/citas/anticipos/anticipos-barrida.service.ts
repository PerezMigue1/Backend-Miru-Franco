import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AnticiposCitasService, type ResultadoPagoCita } from './anticipos-citas.service';
import { ESTADOS_CITA_LIBERABLE, MINUTOS_ANTES_PAGO_SALON, MOTIVO_ANTICIPO_NO_PAGADO, anticiposDesde } from './anticipos.util';

/** Citas por consulta: se recorren de 50 en 50 por id hasta terminar. */
const LOTE = 50;
/**
 * Si Mercado Pago falla al consultar el pago, la cita se reintenta en las siguientes pasadas solo durante
 * este margen tras el vencimiento; después se cancela sin consultar (un pago tardío llega por webhook y
 * queda en revisión).
 */
const MARGEN_REINTENTO_MP_MS = 30 * 60_000;

/**
 * Libera las citas cuyo anticipo no se pagó a tiempo (corre con cada 'barrido.tick' de BarridoService).
 * Solo toca citas creadas desde ANTICIPOS_DESDE: sin esa variable no cancela nada.
 */
@Injectable()
export class AnticiposBarridaService {
  private readonly logger = new Logger(AnticiposBarridaService.name);
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    // Opcional como en PagosEnLineaService: sin él la barrida cancela sin consultar Mercado Pago.
    @Optional() private readonly anticipos?: AnticiposCitasService,
  ) {}

  @OnEvent('barrido.tick')
  async alBarrer(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.barrer();
    } catch (e) {
      this.logger.error('Falló la barrida de anticipos vencidos', e);
    } finally {
      this.corriendo = false;
    }
  }

  async barrer(ahora: Date = new Date()): Promise<{ desactivada: true } | { canceladas: number[]; pagadas: number[] }> {
    const desde = anticiposDesde();
    if (!desde) return { desactivada: true };
    const vencidas = {
      anticipoRequerido: { gt: 0 },
      anticipoPagadoEn: null,
      anticipoVenceEn: { lte: ahora },
      estado: { in: [...ESTADOS_CITA_LIBERABLE] },
      creadoEn: { gte: desde },
    };
    const canceladas: number[] = [];
    // Citas cuyo pago aprobado en Mercado Pago se aplicó aquí (el webhook no había llegado).
    const pagadas: number[] = [];
    // Cursor `id > último` (no cursor + skip): la cita cancelada deja de cumplir el filtro.
    let ultimo: number | undefined;
    for (;;) {
      const lote = await this.prisma.cita.findMany({
        where: { ...vencidas, ...(ultimo === undefined ? {} : { id: { gt: ultimo } }) },
        orderBy: { id: 'asc' },
        take: LOTE,
        select: { id: true, clienteId: true, especialistaId: true, anticipoEnSalon: true, anticipoVenceEn: true },
      });
      for (const cita of lote) {
        try {
          // Antes de liberarla, el pago pudo hacerse sin que llegara el webhook: se consulta en Mercado Pago
          // (una vez por cita: pagada o cancelada, sale del filtro).
          const limite = (cita.anticipoVenceEn?.getTime() ?? 0) + MARGEN_REINTENTO_MP_MS;
          if (this.anticipos && ahora.getTime() < limite) {
            let resultado: ResultadoPagoCita | null;
            try {
              resultado = await this.anticipos.aplicarPagoAprobadoDeMp(cita.id);
            } catch {
              // Sin respuesta de Mercado Pago no se cancela: se reintenta en la siguiente pasada.
              this.logger.warn(`Barrida de anticipos: no se pudo consultar el pago de la cita ${cita.id} en Mercado Pago; se reintenta`);
              continue;
            }
            if (resultado === 'pagado') {
              pagadas.push(cita.id);
              continue;
            }
          }
          // Condicional: si el anticipo se pagó un instante antes, la cita no se toca.
          const r = await this.prisma.cita.updateMany({
            where: { id: cita.id, ...vencidas },
            data: { estado: 'cancelada', motivoCancelacion: MOTIVO_ANTICIPO_NO_PAGADO },
          });
          if (r.count !== 1) continue;
          canceladas.push(cita.id);
          // Avisa a la clienta y a la especialista y descarta los recordatorios (listener de 'cita.cancelada').
          this.eventEmitter.emit('cita.cancelada', {
            citaId: cita.id,
            clienteId: cita.clienteId,
            especialistaId: cita.especialistaId,
            // Anticipo en el salón: el plazo vence minutos antes de la cita, no al pasar el plazo en línea.
            motivo: cita.anticipoEnSalon
              ? `No recibimos tu anticipo ${MINUTOS_ANTES_PAGO_SALON} minutos antes de tu cita y el horario quedó libre. Tus próximas citas se apartan pagando el anticipo en línea.`
              : 'No recibimos el anticipo a tiempo y el horario quedó libre',
          });
        } catch (e) {
          // Una cita que falla no detiene la barrida; se reintenta en la siguiente.
          this.logger.error(`Barrida de anticipos: falló la cita ${cita.id}`, e instanceof Error ? e.stack ?? e.message : e);
        }
      }
      if (lote.length < LOTE) break;
      ultimo = lote[lote.length - 1].id;
    }
    return { canceladas, pagadas };
  }
}
