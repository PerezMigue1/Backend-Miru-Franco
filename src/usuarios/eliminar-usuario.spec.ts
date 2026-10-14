import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsuariosController } = require('./usuarios.controller');

/** DELETE /usuarios/:id (borrado lógico): el admin no se desactiva a sí mismo ni deja al sistema sin admins. */
function servicio(usuario: Record<string, unknown> | null, adminsRestantes: number) {
  const prisma = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(usuario),
      count: jest.fn().mockResolvedValue(adminsRestantes),
      update: jest.fn(async ({ data }: any) => ({ ...usuario, ...data })),
    },
  };
  return { s: new UsuariosService(prisma as any, {} as any, {} as any, {} as any), prisma };
}

describe('DELETE /usuarios/:id', () => {
  it('el admin no puede eliminarse a sí mismo: 403 en español y no llega al servicio', async () => {
    const usuariosService = { eliminarUsuario: jest.fn() };
    const controller = new UsuariosController(usuariosService);
    const e = await controller.eliminarUsuario('adm-1', { user: { id: 'adm-1' } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e.message).toBe('No puedes eliminar tu propia cuenta');
    expect(usuariosService.eliminarUsuario).not.toHaveBeenCalled();
  });

  it('eliminar al último admin activo: 400 y no se desactiva', async () => {
    const { s, prisma } = servicio({ id: 'adm-2', rol: 'admin', activo: true }, 0);
    await expect(s.eliminarUsuario('adm-2')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('con otro admin activo, o si no es admin, se desactiva', async () => {
    const conOtro = servicio({ id: 'adm-2', rol: 'admin', activo: true }, 1);
    await expect(conOtro.s.eliminarUsuario('adm-2')).resolves.toMatchObject({ success: true });
    expect(conOtro.prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 'adm-2' }, data: { activo: false } });
    const clienta = servicio({ id: 'cli-1', rol: 'cliente', activo: true }, 0);
    await expect(clienta.s.eliminarUsuario('cli-1')).resolves.toMatchObject({ success: true });
  });
});
