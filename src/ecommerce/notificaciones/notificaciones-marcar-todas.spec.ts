import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';

/** PATCH /notificaciones/leidas: la campana marca todas las no leídas de la persona en una sola llamada. */
describe('PATCH /notificaciones/leidas (marcar todas como leídas)', () => {
  const yo = { id: 'u-1' };

  it('la ruta es PATCH "leidas" (no choca con PUT/DELETE ":id")', () => {
    const metodo = NotificacionesController.prototype.marcarTodasLeidas;
    expect(Reflect.getMetadata(PATH_METADATA, metodo)).toBe('leidas');
    expect(Reflect.getMetadata(METHOD_METADATA, metodo)).toBe(RequestMethod.PATCH);
  });

  it('el controlador marca solo las de quien tiene la sesión', async () => {
    const service = { marcarTodasLeidas: jest.fn(async () => ({ success: true, count: 2 })) };
    const controller = new NotificacionesController(service as any, {} as any);
    await expect(controller.marcarTodasLeidas(yo)).resolves.toEqual({ success: true, count: 2 });
    expect(service.marcarTodasLeidas).toHaveBeenCalledWith('u-1');
  });

  it('el servicio actualiza en bloque solo las no leídas propias y guarda cuándo se leyeron', async () => {
    const updateMany = jest.fn(async () => ({ count: 3 }));
    const prisma = { notificacion: { updateMany } };
    const service = new NotificacionesService(prisma as any, {} as any);
    await expect(service.marcarTodasLeidas('u-1')).resolves.toEqual({ success: true, count: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u-1', leida: false },
      data: { leida: true, leidaEn: expect.any(Date) },
    });
  });

  it('sin no leídas responde count 0 sin fallar', async () => {
    const prisma = { notificacion: { updateMany: jest.fn(async () => ({ count: 0 })) } };
    const service = new NotificacionesService(prisma as any, {} as any);
    await expect(service.marcarTodasLeidas('u-1')).resolves.toEqual({ success: true, count: 0 });
  });
});
