import { puedeVerDatosDeClientes } from './permisos-clientes.util';
import { NotificacionesService } from '../../ecommerce/notificaciones/notificaciones.service';
import { DireccionesUsuarioService } from '../../ecommerce/direcciones-usuario/direcciones-usuario.service';
import { EcommerceAccessService } from '../../ecommerce/common/ecommerce-access.service';
import { QuejasService } from '../../quejas/quejas.service';

/**
 * `clientes:lectura` abre los datos de las CLIENTAS (notificaciones, direcciones, quejas), no los de otros
 * empleados ni del admin. El admin ve todo y cada quien ve lo suyo.
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'clientes:lectura', 'pedidos:entregar'],
  becario: ['citas:asignadas', 'clientes:lectura'],
  cliente: ['tienda:propia'],
};
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'est-1': 'estilista', 'est-2': 'estilista', 'bec-1': 'becario', 'adm-1': 'admin' };

function prismaFalso() {
  return {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    notificacion: { findMany: jest.fn(async () => []) },
    direccionUsuario: { findMany: jest.fn(async () => []) },
    queja: { findMany: jest.fn(async () => []) },
  } as any;
}

describe('puedeVerDatosDeClientes: el permiso es sobre clientas', () => {
  it('estilista y becario ven a una clienta, pero no a otro empleado ni al admin', async () => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, 'estilista', 'cli-1', 'est-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'cli-1', 'bec-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'estilista', 'est-2', 'est-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'adm-1', 'bec-1')).toBe(false);
  });

  it('uno mismo y el admin siempre; sin permiso, nunca; persona inexistente, no', async () => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'cli-1', 'cli-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'admin', 'est-2', 'adm-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'est-1', 'cli-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'estilista', 'nadie', 'est-1')).toBe(false);
  });
});

describe('Servicios que usan el criterio', () => {
  it('notificaciones: la estilista no lista las del admin ni las de otra estilista (403); las de una clienta sí', async () => {
    const prisma = prismaFalso();
    const service = new NotificacionesService(prisma, new EcommerceAccessService(prisma));
    await expect(service.listar('est-1', { usuarioId: 'adm-1' })).rejects.toMatchObject({ status: 403 });
    await expect(service.listar('est-1', { usuarioId: 'est-2' })).rejects.toMatchObject({ status: 403 });
    await expect(service.listar('est-1', { usuarioId: 'cli-1' })).resolves.toMatchObject({ success: true });
  });

  it('direcciones: el becario no lista las del admin (403); las de una clienta sí', async () => {
    const prisma = prismaFalso();
    const service = new DireccionesUsuarioService(prisma, new EcommerceAccessService(prisma));
    await expect(service.listar('bec-1', 'adm-1')).rejects.toMatchObject({ status: 403 });
    await expect(service.listar('bec-1', 'cli-1')).resolves.toMatchObject({ success: true });
  });

  it('quejas: la estilista no lista las de otra estilista (403); las de una clienta sí; el admin todas', async () => {
    const prisma = prismaFalso();
    const service = new QuejasService(prisma);
    await expect(service.listarPorCliente('est-2', 'est-1')).rejects.toMatchObject({ status: 403 });
    await expect(service.listarPorCliente('cli-1', 'est-1')).resolves.toMatchObject({ success: true });
    await expect(service.listarPorCliente('est-2', 'adm-1')).resolves.toMatchObject({ success: true });
  });
});
