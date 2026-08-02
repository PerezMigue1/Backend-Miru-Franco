import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InAppDispatcher } from './dispatchers/in-app.dispatcher';
import { CanalDispatcher } from './dispatchers/canal-dispatcher.interface';

/**
 * Drena envíos 'pendiente' pasándolos por el dispatcher de su canal. Solo
 * 'in_app' tiene dispatcher registrado en esta etapa; cualquier otro canal
 * (email/push/whatsapp) se ignora sin marcar error — queda 'pendiente' para
 * cuando exista su dispatcher + el barrido programado de etapas futuras.
 */
@Injectable()
export class DespachadorService {
  private readonly logger = new Logger(DespachadorService.name);
  private readonly dispatchers: Partial<Record<string, CanalDispatcher>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inAppDispatcher: InAppDispatcher,
  ) {
    this.dispatchers = { in_app: this.inAppDispatcher };
  }

  /**
   * Llamado FUERA de la transacción del outbox, sin await en la ruta crítica
   * (fire-and-forget deliberado): un fallo aquí nunca debe poder afectar la
   * respuesta HTTP del caso de uso que generó la notificación. Recibe los ids
   * de los envíos recién encolados por esa llamada puntual — no barre todo el
   * backlog 'pendiente' de la tabla (eso es el barrido programado de una etapa
   * futura, todavía no implementado).
   */
  drenarInmediatas(envioIds: string[]): void {
    if (envioIds.length === 0) return;
    this.drenar(envioIds).catch((e) =>
      this.logger.error('Fallo al drenar envíos in-app (quedan pendientes para el barrido futuro)', e),
    );
  }

  private async drenar(envioIds: string[]): Promise<void> {
    const pendientes = await this.prisma.notificacionEnvio.findMany({
      where: { id: { in: envioIds }, estado: 'pendiente' },
      include: { notificacion: true },
    });
    for (const envio of pendientes) {
      const dispatcher = this.dispatchers[envio.canal];
      if (!dispatcher) continue;
      try {
        await dispatcher.enviar(envio);
      } catch (e) {
        this.logger.error(`Fallo al despachar envío ${envio.id} (canal ${envio.canal}, queda pendiente)`, e);
      }
    }
  }
}
