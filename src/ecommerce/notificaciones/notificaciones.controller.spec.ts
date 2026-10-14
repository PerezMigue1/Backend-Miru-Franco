import { BadRequestException } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller';

/** GET /notificaciones?leida=: solo true o false; otro valor responde 400 en vez de listar todo. */
describe('GET /notificaciones?leida', () => {
  const montar = () => {
    const service = { listar: jest.fn(async () => ({ success: true, data: [] })) };
    return { service, controller: new NotificacionesController(service as any, {} as any) };
  };
  const yo = { id: 'u-1' };

  it.each([['true', true], ['false', false], [undefined, undefined]])('leida=%s filtra con %s', async (leida, esperado) => {
    const { service, controller } = montar();
    await controller.listar(yo, undefined, leida as string | undefined);
    expect(service.listar).toHaveBeenCalledWith('u-1', { usuarioId: undefined, leida: esperado });
  });

  it.each(['zz', '1', '', 'TRUE'])('leida=%s responde 400 y no consulta', async (leida) => {
    const { service, controller } = montar();
    expect(() => controller.listar(yo, undefined, leida)).toThrow(BadRequestException);
    expect(() => controller.listar(yo, undefined, leida)).toThrow('El parámetro leida debe ser true o false');
    expect(service.listar).not.toHaveBeenCalled();
  });
});
