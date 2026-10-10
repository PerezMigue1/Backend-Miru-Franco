import { RESPUESTA_CORREO_ANONIMA, UsuariosService } from './usuarios.service';

/** Servicio con un Prisma que devuelve `usuario` en findUnique. */
function servicioCon(usuario: Record<string, unknown> | null) {
  const prisma = { usuario: { findUnique: jest.fn().mockResolvedValue(usuario) } };
  const servicio = new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
  return { servicio, prisma };
}

describe('verificarCorreoExistente: no revela si el correo existe', () => {
  it('anónimo: misma respuesta constante exista o no el correo, sin consultar la base', async () => {
    const existe = servicioCon({ id: 'u-1' });
    const noExiste = servicioCon(null);

    const r1 = await existe.servicio.verificarCorreoExistente('ana@example.com');
    const r2 = await noExiste.servicio.verificarCorreoExistente('nadie@example.com');

    expect(r1).toEqual({ existe: false, message: 'Comprobaremos el correo al crear la cuenta' });
    expect(r2).toEqual(r1);
    expect(RESPUESTA_CORREO_ANONIMA).toEqual(r1);
    expect(existe.prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(noExiste.prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('admin: consulta real con select mínimo', async () => {
    const existe = servicioCon({ id: 'u-1' });
    const r = await existe.servicio.verificarCorreoExistente('Ana@Example.com', { consultaReal: true });
    expect(r.existe).toBe(true);
    expect(existe.prisma.usuario.findUnique).toHaveBeenCalledWith({
      where: { email: 'ana@example.com' },
      select: { id: true },
    });

    const noExiste = servicioCon(null);
    expect((await noExiste.servicio.verificarCorreoExistente('nadie@example.com', { consultaReal: true })).existe).toBe(false);
  });
});
