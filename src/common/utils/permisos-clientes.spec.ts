import { puedeVerDatosDeClientes } from './permisos-clientes.util';
import { NotificacionesService } from '../../ecommerce/notificaciones/notificaciones.service';
import { DireccionesUsuarioService } from '../../ecommerce/direcciones-usuario/direcciones-usuario.service';
import { EcommerceAccessService } from '../../ecommerce/common/ecommerce-access.service';
import { QuejasService } from '../../quejas/quejas.service';

/**
 * `clientes:lectura` abre los datos ajenos (notificaciones, direcciones, quejas) SOLO de usuarios con
 * rol 'cliente'. Los de otro miembro del personal (estilista, becario, admin) quedan denegados aunque
 * se tenga la clave. El admin ve todo, cada quien ve lo suyo y quien no tiene la clave (la clienta)
 * no ve datos ajenos.
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'clientes:lectura', 'pedidos:entregar'],
  becario: ['citas:asignadas', 'clientes:lectura'],
  cliente: ['tienda:propia'],
};
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'cli-2': 'cliente', 'est-1': 'estilista', 'est-2': 'estilista', 'bec-1': 'becario', 'adm-1': 'admin' };

function prismaFalso() {
  return {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    notificacion: { findMany: jest.fn(async () => []) },
    direccionUsuario: { findMany: jest.fn(async () => []) },
    queja: { findMany: jest.fn(async () => []) },
  } as any;
}

describe('puedeVerDatosDeClientes: clientes:lectura, admin o uno mismo', () => {
  it('estilista y becario (clientes:lectura) ven a una clienta; a otro miembro del personal ya no', async () => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, 'estilista', 'cli-1', 'est-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'cli-1', 'bec-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'estilista', 'est-2', 'est-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'adm-1', 'bec-1')).toBe(false);
  });

  it('becaria: a una clienta sí; a una estilista y al admin no; a sí misma siempre', async () => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'cli-1', 'bec-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'est-1', 'bec-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'adm-1', 'bec-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'becario', 'bec-1', 'bec-1')).toBe(true);
  });

  it('uno mismo y el admin siempre; la clienta sin la clave no ve datos ajenos', async () => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'cli-1', 'cli-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'admin', 'est-2', 'adm-1')).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'est-1', 'cli-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'cli-2', 'cli-1')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, null, 'cli-2', 'nadie')).toBe(false);
  });
});

describe('Servicios que usan el criterio', () => {
  it('notificaciones: la estilista lista las de una clienta; las de otra estilista ya no (403); la clienta no las de otra (403)', async () => {
    const prisma = prismaFalso();
    const service = new NotificacionesService(prisma, new EcommerceAccessService(prisma));
    await expect(service.listar('est-1', { usuarioId: 'est-2' })).rejects.toMatchObject({ status: 403 });
    await expect(service.listar('est-1', { usuarioId: 'cli-1' })).resolves.toMatchObject({ success: true });
    await expect(service.listar('cli-1', { usuarioId: 'cli-2' })).rejects.toMatchObject({ status: 403 });
  });

  it('direcciones: el becario lista las de una clienta y las suyas; las del admin ya no (403); la clienta no las de otra (403)', async () => {
    const prisma = prismaFalso();
    const service = new DireccionesUsuarioService(prisma, new EcommerceAccessService(prisma));
    await expect(service.listar('bec-1', 'adm-1')).rejects.toMatchObject({ status: 403 });
    await expect(service.listar('bec-1', 'cli-1')).resolves.toMatchObject({ success: true });
    await expect(service.listar('bec-1', 'bec-1')).resolves.toMatchObject({ success: true });
    await expect(service.listar('cli-1', 'cli-2')).rejects.toMatchObject({ status: 403 });
  });

  it('quejas: la estilista lista las de una clienta; las de otra estilista ya no (403); la clienta no las ajenas (403); el admin todas', async () => {
    const prisma = prismaFalso();
    const service = new QuejasService(prisma);
    await expect(service.listarPorCliente('est-2', 'est-1')).rejects.toMatchObject({ status: 403 });
    await expect(service.listarPorCliente('cli-1', 'est-1')).resolves.toMatchObject({ success: true });
    await expect(service.listarPorCliente('cli-2', 'cli-1')).rejects.toMatchObject({ status: 403 });
    await expect(service.listarPorCliente('est-2', 'adm-1')).resolves.toMatchObject({ success: true });
  });
});
