import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * Bus en memoria (un Subject por usuarioId) que alimenta el endpoint SSE del
 * bloque 6. Vive en un solo proceso: si el backend corre con más de una
 * instancia (Render con >1 dyno), un usuario solo recibe push en vivo en la
 * instancia donde tiene la conexión SSE abierta — las demás instancias no se
 * enteran. No es un problema para esta etapa (Render corre 1 instancia hoy,
 * verificado NO en este bloque sino asumido del entorno actual del proyecto);
 * si se escala horizontalmente, esto necesitaría un pub/sub externo (Redis).
 * Dejo la nota porque es una limitación real del diseño, no un bug.
 */
/**
 * `id` fijo ('0') en cada MessageEvent: `SseStream.writeMessage` (Nest core)
 * auto-asigna un `id` incremental a cualquier mensaje que llegue con `id`
 * falsy (undefined, '', null) — no hay forma de emitir un evento SIN id a
 * través del serializador de `@Sse()`. Un `id` constante evita que
 * `lastEventId` crezca en el server; en el cliente, `fetch-event-source`
 * seguirá guardando ese valor como `Last-Event-ID` para reintentos internos,
 * pero al ser siempre el mismo string no revela progreso real de stream (no
 * hay replay de eventos perdidos en este diseño) y el header ya está
 * permitido en CORS (ver main.ts).
 */
export const SSE_EVENT_ID = '0';

@Injectable()
export class NotificacionesSseService {
  private readonly buses = new Map<string, Subject<MessageEvent>>();

  emitir(usuarioId: string, notificacion: object): void {
    this.buses.get(usuarioId)?.next({ data: notificacion, type: 'notificacion', id: SSE_EVENT_ID });
  }

  stream(usuarioId: string): Observable<MessageEvent> {
    const bus = this.busDe(usuarioId);
    return bus.asObservable().pipe(
      finalize(() => {
        if (!bus.observed) this.buses.delete(usuarioId);
      }),
    );
  }

  private busDe(usuarioId: string): Subject<MessageEvent> {
    let bus = this.buses.get(usuarioId);
    if (!bus) {
      bus = new Subject<MessageEvent>();
      this.buses.set(usuarioId, bus);
    }
    return bus;
  }
}
