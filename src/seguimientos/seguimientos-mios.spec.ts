import { SeguimientosService } from './seguimientos.service';

/**
 * GET /api/seguimientos/mios: la clienta ve sus seguimientos posteriores al servicio (antes la pantalla mostraba
 * datos inventados de 2024). Solo los suyos, por el id del token, nunca por un id que mande el cliente.
 */
describe('Mis seguimientos', () => {
  function montar() {
    const prisma = {
      seguimientoPostServicio: {
        findMany: jest.fn(async () => [
          { id: 3, notas: 'Quedó contenta con el resultado.', fechaContacto: new Date('2026-10-10T16:00:00.000Z'), satisfaccion: 5, requiereAccion: false, cita: { servicio: { nombre: 'Nanoplastia' } } },
        ]),
      },
    };
    return { servicio: new SeguimientosService(prisma as any), prisma };
  }

  it('filtra por la usuaria del token y devuelve servicio, fecha y satisfacción, sin las notas internas del personal', async () => {
    const { servicio, prisma } = montar();
    const r = await servicio.listarMios('cli-1');
    const args = (prisma.seguimientoPostServicio.findMany.mock.calls[0] as any)[0];
    expect(args.where).toEqual({ usuarioId: 'cli-1' });
    expect(args.select).not.toHaveProperty('notas');
    expect(r.data).toEqual([{ id: 3, servicio: 'Nanoplastia', fechaContacto: new Date('2026-10-10T16:00:00.000Z'), satisfaccion: 5 }]);
  });

  it('la ruta existe sin @Permisos de personal (cualquier sesión) y usa el id del token', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SeguimientosController } = require('./seguimientos.controller');
    const metodo = SeguimientosController.prototype.listarMios;
    expect(Reflect.getMetadata('path', metodo)).toBe('mios');
    expect(Reflect.getMetadata('permisos', metodo)).toBeUndefined();
    const svc = { listarMios: jest.fn(async () => ({ data: [] })) };
    await new SeguimientosController(svc as any).listarMios({ user: { id: 'cli-1' } });
    expect(svc.listarMios).toHaveBeenCalledWith('cli-1');
  });
});
