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
@Injectable()
export class NotificacionesSseService {
  private readonly buses = new Map<string, Subject<MessageEvent>>();

  emitir(usuarioId: string, notificacion: object): void {
    this.buses.get(usuarioId)?.next({ data: notificacion, type: 'notificacion' });
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
