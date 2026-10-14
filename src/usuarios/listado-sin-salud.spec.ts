import { UsuariosService } from './usuarios.service';

/**
 * GET /usuarios (listado del admin): sin datos de salud ni capilares de todas las cuentas. Ninguna pantalla
 * de lista los muestra; el detalle (GET /usuarios/:id) sí los sigue trayendo.
 */
const CAMPOS_SALUD_Y_CAPILARES = ['tipoCabello', 'colorNatural', 'colorActual', 'productosUsados', 'alergias', 'tratamientosQuimicos', 'tratamientos'];

function servicio() {
  const prisma = {
    usuario: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }),
    },
  };
  return { s: new UsuariosService(prisma as any, {} as any, {} as any, {} as any), prisma };
}

describe('Listado de usuarios sin datos de salud', () => {
  it('obtenerUsuarios no selecciona campos de salud ni capilares', async () => {
    const { s, prisma } = servicio();
    await s.obtenerUsuarios(undefined, true);
    const { select } = prisma.usuario.findMany.mock.calls[0][0];
    for (const campo of CAMPOS_SALUD_Y_CAPILARES) expect(select).not.toHaveProperty(campo);
    expect(select).toMatchObject({ id: true, nombre: true, email: true, telefono: true, rol: true, activo: true, foto: true });
  });

  it('el detalle por id sí los trae', async () => {
    const { s, prisma } = servicio();
    await s.obtenerUsuarioPorId('u-1');
    const { select } = prisma.usuario.findUnique.mock.calls[0][0];
    for (const campo of CAMPOS_SALUD_Y_CAPILARES) expect(select[campo]).toBe(true);
  });
});
