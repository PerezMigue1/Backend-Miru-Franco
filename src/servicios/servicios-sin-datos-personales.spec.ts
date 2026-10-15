import { ServiciosService } from './servicios.service';

/**
 * GET /api/servicios es público: de las especialistas solo sale su id y su nombre. Nunca el correo ni otro dato
 * personal (antes iba el email de cada especialista).
 */
describe('GET /servicios sin datos personales de las especialistas', () => {
  const fila = {
    id: 2, nombre: 'Nanoplastia', activo: true, anticipoMonto: null,
    productosAsociados: [],
    especialistas: [{ id: 1, servicioId: 2, usuarioId: 'u-1', usuario: { id: 'u-1', nombre: 'Estilista Uno' } }],
  };

  function montar() {
    const prisma = {
      servicio: {
        findMany: jest.fn(async () => [fila]),
        create: jest.fn(async () => fila),
        update: jest.fn(async () => fila),
        findUnique: jest.fn(async () => fila),
      },
      servicioEspecialista: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      $transaction: jest.fn(async (fn: any) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))),
    };
    return { servicio: new ServiciosService(prisma as any), prisma };
  }

  const seleccionUsuario = (llamada: any) => llamada?.[0]?.include?.especialistas?.include?.usuario?.select;

  it('la consulta pide solo id y nombre de la especialista', async () => {
    const { servicio, prisma } = montar();
    await servicio.listar();
    expect(seleccionUsuario(prisma.servicio.findMany.mock.calls[0])).toEqual({ id: true, nombre: true });
  });

  it('crear y actualizar tampoco devuelven el correo de las especialistas', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fuente = require('node:fs').readFileSync(require('node:path').join(__dirname, 'servicios.service.ts'), 'utf8');
    expect(fuente).not.toMatch(/usuario:\s*\{\s*select:\s*\{[^}]*email/);
  });
});
