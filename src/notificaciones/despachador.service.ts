import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InAppDispatcher } from './dispatchers/in-app.dispatcher';
import { EmailDispatcher } from './dispatchers/email.dispatcher';
import { CanalDispatcher } from './dispatchers/canal-dispatcher.interface';

/** Envíos que fallan repetido dejan de reintentarse (pasan a 'fallida') para no
 *  martillar un canal roto en cada tick del barrido para siempre. */
const MAX_INTENTOS = 5;
const BATCH_SIZE = 200;

/**
 * Drena envíos 'pendiente' pasándolos por el dispatcher de su canal. 'in_app' y
 * 'email' tienen dispatcher registrado; cualquier otro canal (push/whatsapp) se
 * ignora sin marcar error — queda 'pendiente' para cuando exista su dispatcher.
 */
@Injectable()
export class DespachadorService {
  private readonly logger = new Logger(DespachadorService.name);
  private readonly dispatchers: Partial<Record<string, CanalDispatcher>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inAppDispatcher: InAppDispatcher,
    private readonly emailDispatcher: EmailDispatcher,
  ) {
    this.dispatchers = { in_app: this.inAppDispatcher, email: this.emailDispatcher };
  }

  /**
   * Llamado FUERA de la transacción del outbox, sin await en la ruta crítica
   * (fire-and-forget deliberado): un fallo aquí nunca debe poder afectar la
   * respuesta HTTP del caso de uso que generó la notificación. Recibe los ids
   * de los envíos recién encolados por esa llamada puntual — no barre todo el
   * backlog 'pendiente' de la tabla (eso lo hace `drenarPendientes`, llamado
   * por `BarridoService` cada 5 min).
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

  /**
   * Barrido: recoge TODO el backlog 'pendiente' con `programadoPara` ya
   * vencido (usa `notificaciones_envios_estado_programado_para_idx`), no solo
   * los de una llamada puntual. Llamado por `BarridoService` — nunca por el
   * flujo síncrono de un caso de uso.
   *
   * Idempotencia ante ticks solapados (uno lento + el siguiente arranca antes
   * de que termine): "claim" vía `updateMany` con `WHERE estado='pendiente'`
   * ANTES de despachar. Bajo Postgres/READ COMMITTED, si dos ticks intentan
   * reclamar el mismo id, el segundo `updateMany` re-evalúa ese WHERE tras el
   * lock de fila del primero y ya no matchea (el primero ya lo dejó en
   * 'enviando') — sin necesidad de `SELECT ... FOR UPDATE SKIP LOCKED` ni SQL
   * crudo. Solo despacho lo que YO reclamé (re-leo por id + estado='enviando').
   */
  async drenarPendientes(): Promise<void> {
    const ahora = new Date();
    const candidatos = await this.prisma.notificacionEnvio.findMany({
      where: { estado: 'pendiente', programadoPara: { lte: ahora } },
      take: BATCH_SIZE,
      select: { id: true },
    });
    if (candidatos.length === 0) return;

    const ids = candidatos.map((c) => c.id);
    const claim = await this.prisma.notificacionEnvio.updateMany({
      where: { id: { in: ids }, estado: 'pendiente' },
      data: { estado: 'enviando' },
    });
    if (claim.count === 0) return; // otro tick ya se los llevó

    const reclamados = await this.prisma.notificacionEnvio.findMany({
      where: { id: { in: ids }, estado: 'enviando' },
      include: { notificacion: true },
    });

    for (const envio of reclamados) {
      const dispatcher = this.dispatchers[envio.canal];
      if (!dispatcher) {
        // Canal sin dispatcher todavía (push/whatsapp): revertir a 'pendiente'
        // sin contar como intento fallido, para que el barrido futuro lo tome
        // en cuanto exista su dispatcher.
        await this.prisma.notificacionEnvio.update({
          where: { id: envio.id },
          data: { estado: 'pendiente' },
        });
        continue;
      }
      try {
        await dispatcher.enviar(envio);
      } catch (e) {
        const intentos = envio.intentos + 1;
        if (intentos >= MAX_INTENTOS) {
          this.logger.error(
            `Envío ${envio.id} (canal ${envio.canal}) agotó ${MAX_INTENTOS} intentos, marcado 'fallida'`,
            e,
          );
          await this.prisma.notificacionEnvio.update({
            where: { id: envio.id },
            data: { estado: 'fallida', intentos, errorMensaje: this.mensajeError(e) },
          });
        } else {
          this.logger.warn(
            `Fallo al despachar envío ${envio.id} (canal ${envio.canal}, intento ${intentos}/${MAX_INTENTOS}, vuelve a 'pendiente')`,
          );
          await this.prisma.notificacionEnvio.update({
            where: { id: envio.id },
            data: { estado: 'pendiente', intentos, errorMensaje: this.mensajeError(e) },
          });
        }
      }
    }
  }

  private mensajeError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.slice(0, 500);
  }
}
