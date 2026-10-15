import { MessageEvent } from '@nestjs/common';
import { firstValueFrom, take, toArray } from 'rxjs';
import { NotificacionesController } from '../../ecommerce/notificaciones/notificaciones.controller';
import { NotificacionesSseService, SSE_EVENT_ID } from './notificaciones-sse.service';

/** El flujo en vivo (GET /api/notificaciones/stream) es por usuario: nadie recibe avisos ajenos. */
describe('SSE de notificaciones: cada usuario recibe solo lo suyo', () => {
  it('lo emitido para una usuaria no llega a la conexión de otra', async () => {
    const sse = new NotificacionesSseService();
    const deAna: MessageEvent[] = [];
    const deBeto: MessageEvent[] = [];
    const subAna = sse.stream('ana').subscribe((e) => deAna.push(e));
    const subBeto = sse.stream('beto').subscribe((e) => deBeto.push(e));

    sse.emitir('ana', { id: 'n-1', titulo: 'Cita agendada' });
    sse.emitir('beto', { id: 'n-2', titulo: 'Pedido nuevo' });
    sse.emitir('carla', { id: 'n-3', titulo: 'Sin conexión abierta' });

    expect(deAna).toEqual([{ type: 'notificacion', id: SSE_EVENT_ID, data: { id: 'n-1', titulo: 'Cita agendada' } }]);
    expect(deBeto).toEqual([{ type: 'notificacion', id: SSE_EVENT_ID, data: { id: 'n-2', titulo: 'Pedido nuevo' } }]);
    subAna.unsubscribe();
    subBeto.unsubscribe();
  });

  it('dos pestañas de la misma usuaria reciben el mismo aviso; al cerrar las dos se libera el canal', () => {
    const sse = new NotificacionesSseService();
    const a: MessageEvent[] = [];
    const b: MessageEvent[] = [];
    const s1 = sse.stream('ana').subscribe((e) => a.push(e));
    const s2 = sse.stream('ana').subscribe((e) => b.push(e));
    sse.emitir('ana', { id: 'n-1' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    s1.unsubscribe();
    s2.unsubscribe();
    expect((sse as any).buses.size).toBe(0);
  });

  it('el endpoint abre el flujo con el id del token, nunca con un id pedido por el cliente', async () => {
    const sse = new NotificacionesSseService();
    const stream = jest.spyOn(sse, 'stream');
    const controller = new NotificacionesController({} as any, sse);
    const recibido = firstValueFrom(controller.stream({ id: 'ana' }).pipe(take(1), toArray()));
    sse.emitir('beto', { id: 'ajena' });
    sse.emitir('ana', { id: 'propia' });
    expect(stream).toHaveBeenCalledWith('ana');
    await expect(recibido).resolves.toEqual([{ type: 'notificacion', id: SSE_EVENT_ID, data: { id: 'propia' } }]);
  });
});
