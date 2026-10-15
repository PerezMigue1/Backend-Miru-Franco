import { Prisma } from '@prisma/client';
import { PosService } from './pos.service';

/**
 * Punto de venta: un producto desactivado (borrado lógico, activo=false) ya no se cobra. La venta
 * responde 400 en español y no se crea; las ventas pasadas no se tocan.
 */
function montar(producto: { activo: boolean } | undefined) {
  const creadas: unknown[] = [];
  const tx: any = {
    ventaLocal: {
      create: jest.fn(async ({ data }: any) => {
        creadas.push(data);
        return { id: 7, ...data };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: 7, ...data, clienteId: null })),
    },
  };
  const prisma: any = {
    productoPresentacion: {
      findUnique: jest.fn(async () => ({ id: 3, precio: new Prisma.Decimal(250), stock: 10, disponible: true, producto })),
    },
    pago: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const inventario = { registrarSalida: jest.fn(async () => ({})) };
  const pos = new PosService(prisma, inventario as any, { emit: jest.fn() } as any);
  return { pos, creadas, prisma };
}

describe('POS: no se vende un producto inactivo', () => {
  it('400 con mensaje claro y no se crea la venta', async () => {
    const { pos, creadas } = montar({ activo: false });
    await expect(
      pos.crearVenta({ metodoPago: 'efectivo', items: [{ presentacionId: 3, cantidad: 1 }] } as any, 'caj-1'),
    ).rejects.toMatchObject({ status: 400, message: 'Este producto ya no está a la venta (presentación 3)' });
    expect(creadas).toHaveLength(0);
  });

  it('pide a la base si el producto de la presentación está activo', async () => {
    const { pos, prisma } = montar({ activo: true });
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ presentacionId: 3, cantidad: 1 }] } as any, 'caj-1').catch(() => undefined);
    expect(prisma.productoPresentacion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ producto: { select: { activo: true } } }) }),
    );
  });
});
