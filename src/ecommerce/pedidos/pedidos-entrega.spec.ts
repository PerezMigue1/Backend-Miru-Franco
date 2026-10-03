import { EstadoPedido } from '@prisma/client';
import { PedidosService } from './pedidos.service';

jest.mock('../common/pedido-inventario.util', () => ({
  cantidadPorPresentacion: jest.fn(() => new Map()),
  decrementarStockPresentaciones: jest.fn(async () => undefined),
  incrementarStockPorLineas: jest.fn(async () => undefined),
}));

const CLIENTA = 'clienta-1';
/** Permisos por rol como en permisos_rol: la estilista tiene caja y entrega; el empleado solo entrega. */
const PERMISOS: Record<string, string[]> = {
  estilista: ['caja:escritura', 'pedidos:entregar'],
  empleado: ['pedidos:entregar'],
  cajera: ['caja:escritura'],
  cliente: [],
};
const ROL_DE: Record<string, string> = { 'estilista-1': 'estilista', 'empleado-1': 'empleado', 'cajera-1': 'cajera', 'admin-1': 'admin', [CLIENTA]: 'cliente' };

function montar(pedido: { estado: EstadoPedido; metodoPago?: string; total?: number; pagadoEn?: Date | null }) {
  const actual = { id: 7, usuarioId: CLIENTA, metodoPago: 'pago_en_salon', total: 350, pagadoEn: null as Date | null, ...pedido };
  const pagos: Record<string, unknown>[] = [];
  const historial: Record<string, unknown>[] = [];
  const tx = {
    pedidoItem: { findMany: jest.fn(async () => []) },
    pedido: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== actual.id || where.estado !== actual.estado) return { count: 0 };
        Object.assign(actual, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => (Object.assign(actual, data), { ...actual })),
      findUnique: jest.fn(async () => ({ ...actual })),
    },
    pago: { create: jest.fn(async ({ data }: any) => (pagos.push(data), { id: 1, ...data })) },
    historialEstadoPedido: { create: jest.fn(async ({ data }: any) => historial.push(data)) },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(async () => ({ ...actual })) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => ({ claves: PERMISOS[where.rol] ?? [] })) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = { getRol: jest.fn(async (id: string) => ROL_DE[id] ?? 'cliente'), isAdmin: (rol: string | null) => rol === 'admin' };
  const eventos = { emit: jest.fn() };
  return { servicio: new PedidosService(prisma as any, access as any, eventos as any), actual, pagos, historial, eventos, tx, prisma };
}

describe('Permiso pedidos:entregar', () => {
  it('sin el permiso, marcar listo y entregar dan 403 (aunque tenga caja:escritura)', async () => {
    const listo = montar({ estado: EstadoPedido.preparando });
    await expect(listo.servicio.marcarListo(7, 'cajera-1')).rejects.toMatchObject({ status: 403 });
    const entrega = montar({ estado: EstadoPedido.listo_recoger });
    await expect(entrega.servicio.entregar(7, 'cajera-1', 'efectivo')).rejects.toMatchObject({ status: 403 });
    await expect(entrega.servicio.entregar(7, CLIENTA, 'efectivo')).rejects.toMatchObject({ status: 403 });
    expect(entrega.actual.estado).toBe('listo_recoger');
  });

  it('sin el permiso, tampoco por el PUT general: entregar da 403', async () => {
    const { servicio, actual } = montar({ estado: EstadoPedido.listo_recoger, metodoPago: 'tarjeta_credito' });
    await expect(servicio.actualizar(7, 'cajera-1', { estado: EstadoPedido.entregado })).rejects.toMatchObject({ status: 403 });
    expect(actual.estado).toBe('listo_recoger');
  });

  it('con el permiso y sin caja: marca listo y avisa a la clienta', async () => {
    const { servicio, actual, historial, eventos } = montar({ estado: EstadoPedido.preparando });
    await servicio.marcarListo(7, 'empleado-1');
    expect(actual.estado).toBe('listo_recoger');
    expect(historial).toEqual([expect.objectContaining({ estadoAnterior: 'preparando', estadoNuevo: 'listo_recoger', usuarioId: 'empleado-1' })]);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.listo_recoger', { pedidoId: 7, usuarioId: CLIENTA });
  });

  it('cobrar y entregar un apartado: registra el pago con su método y quién cobró', async () => {
    const { servicio, actual, pagos, eventos } = montar({ estado: EstadoPedido.listo_recoger });
    await servicio.entregar(7, 'empleado-1', 'tarjeta_terminal');
    expect(actual.estado).toBe('entregado');
    expect(actual.pagadoEn).toBeInstanceOf(Date);
    expect(pagos).toEqual([expect.objectContaining({ pedidoId: 7, metodo: 'tarjeta_terminal', estado: 'aprobado', monto: 350, cobradoPorId: 'empleado-1' })]);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.entregado', { pedidoId: 7, usuarioId: CLIENTA });
  });

  it('un apartado no se entrega sin decir cómo se cobró: 400', async () => {
    const { servicio, actual, pagos } = montar({ estado: EstadoPedido.listo_recoger });
    await expect(servicio.entregar(7, 'empleado-1')).rejects.toMatchObject({ status: 400 });
    await expect(servicio.entregar(7, 'empleado-1', 'cheque' as any)).rejects.toMatchObject({ status: 400 });
    expect(actual.estado).toBe('listo_recoger');
    expect(pagos).toHaveLength(0);
  });

  it('un pedido pagado en línea se entrega sin registrar otro pago', async () => {
    const { servicio, actual, pagos } = montar({ estado: EstadoPedido.listo_recoger, metodoPago: 'mercado_pago', pagadoEn: new Date('2026-10-03T17:00:00Z') });
    await servicio.entregar(7, 'empleado-1', 'efectivo');
    expect(actual.estado).toBe('entregado');
    expect(pagos).toHaveLength(0);
  });

  it('un apartado sin pagar no se entrega por el PUT general (no registraría el cobro): 400', async () => {
    const { servicio, actual, pagos } = montar({ estado: EstadoPedido.listo_recoger });
    await expect(servicio.actualizar(7, 'estilista-1', { estado: EstadoPedido.entregado })).rejects.toMatchObject({ status: 400 });
    expect(actual.estado).toBe('listo_recoger');
    expect(actual.pagadoEn).toBeNull();
    expect(pagos).toHaveLength(0);
  });

  it('el admin (*) puede entregar', async () => {
    const { servicio, actual } = montar({ estado: EstadoPedido.listo_recoger });
    await servicio.entregar(7, 'admin-1', 'efectivo');
    expect(actual.estado).toBe('entregado');
  });

  it('solo se entrega lo que está listo para recoger: desde preparando da 400', async () => {
    const { servicio } = montar({ estado: EstadoPedido.preparando });
    await expect(servicio.entregar(7, 'empleado-1', 'efectivo')).rejects.toMatchObject({ status: 400 });
  });
});

describe('Carrera con la barrida de apartados', () => {
  it('si el pedido cambió (la barrida lo canceló) entre la lectura y el guardado: 409 y no se pisa', async () => {
    const { servicio, actual, prisma, historial } = montar({ estado: EstadoPedido.listo_recoger, metodoPago: 'tarjeta_credito' });
    // La barrida lo cancela justo después de que el servicio leyó el pedido.
    prisma.pedido.findUnique.mockImplementationOnce(async () => {
      const leido = { ...actual };
      actual.estado = EstadoPedido.cancelado;
      return leido;
    });
    await expect(servicio.actualizar(7, 'estilista-1', { estado: EstadoPedido.entregado })).rejects.toMatchObject({ status: 409 });
    expect(actual.estado).toBe('cancelado');
    expect(historial).toHaveLength(0);
  });

  it('entregar también es condicional: si lo cancelaron un instante antes, 409 sin cobrar', async () => {
    const { servicio, actual, prisma, pagos } = montar({ estado: EstadoPedido.listo_recoger });
    // La barrida lo cancela justo después de que el servicio leyó el pedido.
    prisma.pedido.findUnique.mockImplementationOnce(async () => {
      const leido = { ...actual };
      actual.estado = EstadoPedido.cancelado;
      return leido;
    });
    await expect(servicio.entregar(7, 'empleado-1', 'efectivo')).rejects.toMatchObject({ status: 409 });
    expect(pagos).toHaveLength(0);
  });
});
