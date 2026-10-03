import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DespachadorService } from './despachador.service';

const INTERVALO_MS = 5 * 60_000;

/**
 * Dispara `DespachadorService.drenarPendientes()` cada 5 min: recoge el
 * backlog 'pendiente' con `programadoPara` vencido (recordatorios, reintentos
 * de envíos in-app/email que fallaron y volvieron a 'pendiente', etc.) que
 * `drenarInmediatas` no cubre por no ser parte de la llamada puntual que los
 * creó.
 *
 * In-process (no GitHub Actions ni endpoint externo): el backend corre como
 * un único servicio `web` siempre activo en Render (ver `render.yaml`), no
 * hay infraestructura de cron externa que replicar. Si el proceso se
 * reinicia, el próximo tick recoge lo atrasado — el barrido es catch-up por
 * diseño, no depende de no perderse ningún tick.
 */
@Injectable()
export class BarridoService {
  private readonly logger = new Logger(BarridoService.name);
  private corriendo = false;

  constructor(
    private readonly despachador: DespachadorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Interval(INTERVALO_MS)
  async tick(): Promise<void> {
    // Guarda en proceso: si un tick anterior sigue corriendo (backlog grande,
    // DB lenta), no lanzar otro en paralelo desde este mismo servicio. No
    // reemplaza el claim atómico de `drenarPendientes` (esa es la defensa
    // real contra solapamiento entre instancias/reinicios), es solo para no
    // apilar llamadas redundantes dentro del mismo proceso.
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.despachador.drenarPendientes();
    } catch (e) {
      this.logger.error('Fallo en el barrido de notificaciones pendientes', e);
    }
    // Otras reglas programadas (apartados y pedidos en línea vencidos) escuchan este evento: así hay una
    // sola tarea programada y Notificaciones no depende de E-commerce. Corren aunque drenar falle.
    try {
      await this.eventEmitter.emitAsync('barrido.tick');
    } catch (e) {
      this.logger.error('Fallo en una regla de la barrida', e);
    } finally {
      this.corriendo = false;
    }
  }
}
