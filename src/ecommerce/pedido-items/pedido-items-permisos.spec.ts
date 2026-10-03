import { ForbiddenException } from '@nestjs/common';
import { EstadoPedido } from '@prisma/client';
import { PedidoItemsService } from './pedido-items.service';
import { HistorialEstadoPedidoService } from '../historial-estado-pedido/historial-estado-pedido.service';

jest.mock('../common/pedido-inventario.util', () => ({
  decrementarStockPresentaciones: jest.fn(async () => undefined),
  incrementarStockPresentaciones: jest.fn(async () => undefined),
}));

const CLIENTA = 'clienta-1';
const ROLES: Record<string, string> = { [CLIENTA]: 'cliente', 'admin-1': 'admin', 'estilista-1': 'estilista' };

function montar(estado: EstadoPedido) {
  const pedido = { id: 7, usuarioId: CLIENTA, estado, costoEnvio: 0, impuestos: 0, descuento: 0, items: [] };
  const item = { id: 30, pedidoId: 7, cantidad: 1, presentacionId: 3, precioUnitario: 100, subtotal: 100, presentacion: { precio: 100, stock: 10, disponible: true }, producto: {} };
  const escrituras: string[] = [];
  const tx = {
    pedidoItem: {
      create: jest.fn(async () => (escrituras.push('crear'), item)),
      update: jest.fn(async () => (escrituras.push('actualizar'), item)),
      delete: jest.fn(async () => (escrituras.push('borrar'), item)),
      findUnique: jest.fn(async () => item),
    },
    pedido: { findUnique: jest.fn(async () => pedido), update: jest.fn(async () => pedido) },
    historialEstadoPedido: { create: jest.fn(async ({ data }: any) => (escrituras.push('historial'), data)) },
  };
  const prisma = {
    ...tx,
    productoPresentacion: { findUnique: jest.fn(async () => ({ id: 3, productoId: 1, precio: 100, stock: 10, disponible: true, tamanio: '250 ml', producto: { nombre: 'Shampoo' } })) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => ({ claves: where.rol === 'estilista' ? ['caja:escritura'] : [] })) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    getRol: jest.fn(async (id: string) => ROLES[id] ?? 'cliente'),
    isAdmin: (rol: string | null) => rol === 'admin',
    assertPedido: jest.fn(async (solicitanteId: string) => {
      if (solicitanteId !== CLIENTA && ROLES[solicitanteId] !== 'admin') throw new ForbiddenException('No tienes permiso');
    }),
  };
  return {
    items: new PedidoItemsService(prisma as any, access as any),
    historial: new HistorialEstadoPedidoService(prisma as any, access as any),
    escrituras,
    tx,
  };
}

const linea = { pedidoId: 7, productoId: 1, presentacionId: 3, cantidad: 1 };

describe('Artículos del pedido: la clienta solo los cambia antes de que se prepare', () => {
  it.each([EstadoPedido.borrador, EstadoPedido.pendiente_pago])('en %s sí puede agregar, cambiar y quitar', async (estado) => {
    const { items, escrituras } = montar(estado);
    await items.crear(CLIENTA, linea as any);
    await items.actualizar(30, CLIENTA, { cantidad: 2 } as any, 7);
    await items.eliminar(30, CLIENTA, 7);
    expect(escrituras).toEqual(expect.arrayContaining(['crear', 'actualizar', 'borrar']));
  });

  it.each([EstadoPedido.pagado, EstadoPedido.preparando, EstadoPedido.listo_recoger, EstadoPedido.entregado])(
    'en %s: 403 al agregar, cambiar o quitar, sin escribir nada',
    async (estado) => {
      const { items, escrituras } = montar(estado);
      await expect(items.crear(CLIENTA, linea as any)).rejects.toMatchObject({ status: 403 });
      await expect(items.actualizar(30, CLIENTA, { cantidad: 2 } as any, 7)).rejects.toMatchObject({ status: 403 });
      await expect(items.eliminar(30, CLIENTA, 7)).rejects.toMatchObject({ status: 403 });
      expect(escrituras).toEqual([]);
    },
  );

  it('un artículo de otro pedido no se toca por la URL de este: 404', async () => {
    const { items, escrituras } = montar(EstadoPedido.pendiente_pago);
    await expect(items.actualizar(30, CLIENTA, { cantidad: 2 } as any, 8)).rejects.toMatchObject({ status: 404 });
    await expect(items.eliminar(30, CLIENTA, 8)).rejects.toMatchObject({ status: 404 });
    expect(escrituras).toEqual([]);
  });
});

describe('Historial de estados: la clienta nunca escribe filas', () => {
  const fila = { pedidoId: 7, estadoAnterior: 'pendiente_pago', estadoNuevo: 'pagado', origen: 'yo', usuarioId: 'otra-persona' };

  it('la dueña del pedido recibe 403 y no se escribe nada', async () => {
    const { historial, escrituras } = montar(EstadoPedido.pendiente_pago);
    await expect(historial.crear(CLIENTA, fila as any)).rejects.toMatchObject({ status: 403 });
    expect(escrituras).toEqual([]);
  });

  it('el personal con caja sí, y el autor es siempre quien la escribe', async () => {
    const { historial, tx } = montar(EstadoPedido.pendiente_pago);
    await historial.crear('estilista-1', fila as any);
    expect(tx.historialEstadoPedido.create).toHaveBeenCalledWith({ data: expect.objectContaining({ usuarioId: 'estilista-1' }) });
  });
});
