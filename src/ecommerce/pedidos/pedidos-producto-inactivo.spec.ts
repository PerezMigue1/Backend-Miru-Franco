import { EstadoPedido } from '@prisma/client';
import { PedidosService } from './pedidos.service';

/**
 * Un producto desactivado (borrado lógico, activo=false) ya no se vende en la tienda: crear un pedido
 * con una de sus presentaciones responde 400 en español y no se crea nada. Los pedidos pasados no se tocan.
 */
const CLIENTA = 'clienta-1';
const STAFF = 'staff-1';

function montar(producto: { nombre: string; activo: boolean }) {
  const tx = { pedido: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 99, ...data })) } };
  const prisma = {
    permisoRol: {
      findUnique: jest.fn(async ({ where }: { where: { rol: string } }) =>
        where.rol === 'empleado' ? { claves: ['caja:escritura', 'pedidos:entregar'] } : { claves: [] },
      ),
    },
    productoPresentacion: {
      findUnique: jest.fn(async () => ({ productoId: 3, disponible: true, stock: 10, precio: 120, tamanio: '250 ml', producto })),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    getRol: jest.fn(async (id: string) => (id === STAFF ? 'empleado' : 'cliente')),
    isAdmin: (rol: string | null) => rol === 'admin',
  };
  const servicio = new PedidosService(prisma as any, access as any, { emit: jest.fn() } as any, {} as any);
  return { servicio, tx };
}

const item = [{ productoId: 3, presentacionId: 1, cantidad: 1 }];

describe('Pedidos: no se vende un producto inactivo', () => {
  it('la clienta recibe 400 en español y no se crea el pedido', async () => {
    const { servicio, tx } = montar({ nombre: 'Shampoo', activo: false });
    const pedido = servicio.crear(CLIENTA, { items: item, estado: EstadoPedido.pendiente_pago, metodoPago: 'mercado_pago' } as any);
    await expect(pedido).rejects.toMatchObject({ status: 400, message: 'Este producto ya no está a la venta (Shampoo)' });
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('el personal tampoco puede crear un pedido con un producto inactivo', async () => {
    const { servicio, tx } = montar({ nombre: 'Shampoo', activo: false });
    await expect(servicio.crear(STAFF, { items: item } as any)).rejects.toMatchObject({
      status: 400,
      message: 'Este producto ya no está a la venta (Shampoo)',
    });
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });
});
