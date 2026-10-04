import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ESTADOS_CITA_LIBERABLE, MOTIVO_ANTICIPO_NO_PAGADO, anticiposDesde } from './anticipos.util';

/** Citas por consulta: se recorren de 50 en 50 por id hasta terminar. */
const LOTE = 50;

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

  async barrer(ahora: Date = new Date()): Promise<{ desactivada: true } | { canceladas: number[] }> {
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
    // Cursor `id > último` (no cursor + skip): la cita cancelada deja de cumplir el filtro.
    let ultimo: number | undefined;
    for (;;) {
      const lote = await this.prisma.cita.findMany({
        where: { ...vencidas, ...(ultimo === undefined ? {} : { id: { gt: ultimo } }) },
        orderBy: { id: 'asc' },
        take: LOTE,
        select: { id: true, clienteId: true, especialistaId: true },
      });
      for (const cita of lote) {
        try {
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
            motivo: 'No recibimos el anticipo a tiempo y el horario quedó libre',
          });
        } catch (e) {
          // Una cita que falla no detiene la barrida; se reintenta en la siguiente.
          this.logger.error(`Barrida de anticipos: falló la cita ${cita.id}`, e instanceof Error ? e.stack ?? e.message : e);
        }
      }
      if (lote.length < LOTE) break;
      ultimo = lote[lote.length - 1].id;
    }
    return { canceladas };
  }
}
