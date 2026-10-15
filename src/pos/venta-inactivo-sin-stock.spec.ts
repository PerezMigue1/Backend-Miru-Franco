import { Prisma } from '@prisma/client';
import { PosService } from './pos.service';

/**
 * Punto de venta: la revisión de producto activo va antes que la de stock. Un producto desactivado
 * (borrado lógico) que además se quedó sin existencias recibe el mensaje de producto no disponible, no
 * el de stock insuficiente; así la cajera no intenta reabastecer algo que ya no se vende.
 */
function montar(stock: number, activo: boolean) {
  const tx: any = {
    ventaLocal: {
      create: jest.fn(async ({ data }: any) => ({ id: 7, ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 7, ...data, clienteId: null })),
    },
  };
  const prisma: any = {
    productoPresentacion: {
      findUnique: jest.fn(async () => ({ id: 3, precio: new Prisma.Decimal(250), stock, disponible: true, producto: { activo } })),
    },
    pago: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const inventario = { registrarSalida: jest.fn(async () => ({})) };
  const pos = new PosService(prisma, inventario as any, { emit: jest.fn() } as any);
  return { pos, tx };
}

const venta = { metodoPago: 'efectivo', items: [{ presentacionId: 3, cantidad: 1 }] } as any;

describe('POS: producto inactivo sin stock', () => {
  it('recibe el mensaje de producto no disponible, no el de stock', async () => {
    const { pos, tx } = montar(0, false);
    await expect(pos.crearVenta(venta, 'caj-1')).rejects.toMatchObject({
      status: 400,
      message: 'Este producto ya no está a la venta (presentación 3)',
    });
    expect(tx.ventaLocal.create).not.toHaveBeenCalled();
  });

  it('un producto activo sin stock sigue recibiendo el mensaje de stock insuficiente', async () => {
    const { pos } = montar(0, true);
    await expect(pos.crearVenta(venta, 'caj-1')).rejects.toMatchObject({
      status: 400,
      message: 'Stock insuficiente para presentación 3: disponible 0, solicitado 1',
    });
  });
});
