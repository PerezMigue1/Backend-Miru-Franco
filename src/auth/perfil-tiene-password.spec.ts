import { AuthService } from './auth.service';

/** GET /api/auth/me: tienePassword se calcula; nunca sale el hash ni los campos del código. */
describe('GET /api/auth/me: tienePassword', () => {
  const datosSeguros = { id: 'u-1', nombre: 'Clienta Prueba', email: 'clienta@example.com', rol: 'cliente' };

  function servicioCon(password: string | null) {
    const prisma = {
      usuario: { findUnique: jest.fn().mockResolvedValue({ password }) },
      permisoRol: { findUnique: jest.fn().mockResolvedValue({ claves: ['citas:propia'] }) },
    };
    const usuariosService = { obtenerUsuarioPorId: jest.fn().mockResolvedValue({ success: true, data: { ...datosSeguros } }) };
    const servicio = new AuthService({} as any, prisma as any, usuariosService as any, {} as any, {} as any);
    return { servicio, prisma };
  }

  it('cuenta con contraseña: tienePassword true, sin el hash', async () => {
    const { servicio, prisma } = servicioCon('$2a$10$hashfalsoparapruebasxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    const r = await servicio.getProfile({ id: 'u-1' });
    expect(r.data).toMatchObject({ ...datosSeguros, tienePassword: true, permisos: ['citas:propia'] });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('$2a$');
    expect(r.data).not.toHaveProperty('password');
    expect(r.data).not.toHaveProperty('codigoOTP');
    expect(r.data).not.toHaveProperty('otpExpira');
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({ where: { id: 'u-1' }, select: { password: true } });
  });

  it('cuenta de Google sin contraseña: tienePassword false', async () => {
    const { servicio } = servicioCon(null);
    const r = await servicio.getProfile({ id: 'u-1' });
    expect(r.data.tienePassword).toBe(false);
  });
});
