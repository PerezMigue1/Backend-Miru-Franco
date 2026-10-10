import { ValoracionesService } from './valoraciones.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';

/**
 * Valoraciones: la lista pública por producto no expone ids de clienta ni de pedido (solo el nombre de
 * pila); editar es solo de la autora (el admin modera borrando); y solo se valora un pedido propio.
 */
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'cli-2': 'cliente', 'adm-1': 'admin' };

function montar() {
  const pedidos = [{ id: 9, usuarioId: 'cli-1' }, { id: 10, usuarioId: 'cli-2' }];
  const valoraciones = [{ id: 5, usuarioId: 'cli-1', productoId: 3, pedidoId: 9, puntuacion: 4, comentario: 'Bien' }];
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async () => null) },
    pedido: { findUnique: jest.fn(async ({ where }: any) => pedidos.find((p) => p.id === where.id) ?? null) },
    pedidoItem: { findFirst: jest.fn(async () => ({ id: 1 })) },
    valoracion: {
      findMany: jest.fn(async () => [
        {
          id: 5,
          puntuacion: 4,
          comentario: 'Bien',
          creadoEn: new Date('2026-10-01T12:00:00Z'),
          usuario: { nombre: 'María Fernanda López Ruiz' },
        },
      ]),
      findUnique: jest.fn(async ({ where }: any) => valoraciones.find((v) => v.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 6, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 5, ...data })),
      delete: jest.fn(async () => ({})),
    },
  };
  return { prisma, service: new ValoracionesService(prisma, new EcommerceAccessService(prisma)) };
}

describe('Valoraciones: privacidad y dueña', () => {
  it('GET /valoraciones/producto/:id pide solo puntuación, comentario, fecha y nombre, y responde sin ids de clienta ni pedido', async () => {
    const { service, prisma } = montar();

    const res = await service.listarPorProducto(3);

    const consulta = prisma.valoracion.findMany.mock.calls[0][0];
    expect(consulta.select).toEqual({
      id: true,
      puntuacion: true,
      comentario: true,
      creadoEn: true,
      usuario: { select: { nombre: true } },
    });
    expect(res.data).toEqual([
      { id: 5, puntuacion: 4, comentario: 'Bien', creadoEn: new Date('2026-10-01T12:00:00Z'), autor: 'María' },
    ]);
  });

  it('PUT /valoraciones/:id: el admin no edita la reseña de otra persona (403 sin escribir); la autora sí', async () => {
    const { service, prisma } = montar();
    await expect(service.actualizar(5, 'adm-1', { comentario: 'Editado' } as any)).rejects.toMatchObject({ status: 403 });
    expect(prisma.valoracion.update).not.toHaveBeenCalled();
    await expect(service.actualizar(5, 'cli-1', { comentario: 'Mejor' } as any)).resolves.toMatchObject({ success: true });
  });

  it('DELETE /valoraciones/:id: el admin sí puede borrar (moderación)', async () => {
    const { service, prisma } = montar();
    await service.eliminar(5, 'adm-1');
    expect(prisma.valoracion.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('POST /valoraciones: nadie (ni el admin) valora sobre el pedido de otra persona', async () => {
    const { service, prisma } = montar();
    await expect(service.crear('adm-1', { pedidoId: 10, productoId: 3, puntuacion: 5 } as any)).rejects.toMatchObject({ status: 403 });
    await expect(service.crear('cli-1', { pedidoId: 10, productoId: 3, puntuacion: 5 } as any)).rejects.toMatchObject({ status: 403 });
    expect(prisma.valoracion.create).not.toHaveBeenCalled();
    await expect(service.crear('cli-2', { pedidoId: 10, productoId: 3, puntuacion: 5 } as any)).resolves.toMatchObject({ success: true });
  });

  it('GET /valoraciones/pedido/:id?propios=true: pedido ajeno 404 incluso para el admin', async () => {
    const { service } = montar();
    await expect(service.listarPorPedido(10, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
    await expect(service.listarPorPedido(10, 'adm-1')).resolves.toMatchObject({ success: true });
  });
});
