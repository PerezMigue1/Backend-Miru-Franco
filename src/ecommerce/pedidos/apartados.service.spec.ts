import { EstadoPedido } from '@prisma/client';
import { ApartadosService } from './apartados.service';

jest.mock('../common/pedido-inventario.util', () => ({
  incrementarStockPorLineas: jest.fn(async () => undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inventario = require('../common/pedido-inventario.util');

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const AHORA = new Date('2026-10-20T18:00:00.000Z');
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

type PedidoPrueba = {
  id: number;
  usuarioId: string;
  estado: EstadoPedido;
  metodoPago: string;
  creadoEn: Date;
  listoDesde?: Date;
};

/** Prisma en memoria que aplica el where (método, estado y rango de creadoEn) como lo haría la base. */
function montar(pedidos: PedidoPrueba[], notificacionesPrevias: { entidadId: string; tipo: string }[] = []) {
  const historial: Record<string, unknown>[] = [];
  const cumple = (p: PedidoPrueba, where: any) =>
    (!where.metodoPago || p.metodoPago === where.metodoPago) &&
    (!where.estado || p.estado === where.estado) &&
    (!where.creadoEn?.gte || p.creadoEn >= where.creadoEn.gte) &&
    (!where.creadoEn?.lte || p.creadoEn <= where.creadoEn.lte);
  const tx = {
    pedido: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const p = pedidos.find((x) => x.id === where.id && x.estado === where.estado);
        if (!p) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      }),
    },
    pedidoItem: { findMany: jest.fn(async () => [{ presentacionId: 3, cantidad: 2 }]) },
    historialEstadoPedido: { create: jest.fn(async ({ data }: any) => historial.push(data)) },
  };
  const prisma = {
    pedido: {
      findMany: jest.fn(async ({ where }: any) =>
        pedidos
          .filter((p) => cumple(p, where))
          .map((p) => ({
            id: p.id,
            usuarioId: p.usuarioId,
            estado: p.estado,
            creadoEn: p.creadoEn,
            historialEstado: p.listoDesde ? [{ creadoEn: p.listoDesde }] : [],
          })),
      ),
    },
    notificacion: {
      findFirst: jest.fn(async ({ where }: any) =>
        notificacionesPrevias.find((n) => n.entidadId === where.entidadId && n.tipo === where.tipo) ?? null,
      ),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const eventos = { emit: jest.fn() };
  const servicio = new ApartadosService(prisma as any, eventos as any);
  return { servicio, prisma, pedidos, historial, eventos, notificacionesPrevias };
}

const apartado = (cambio: Partial<PedidoPrueba>): PedidoPrueba => ({
  id: 1,
  usuarioId: 'clienta-1',
  estado: EstadoPedido.pendiente_pago,
  metodoPago: 'pago_en_salon',
  creadoEn: hace(4 * DIA),
  ...cambio,
});

describe('Apartados y pedidos en línea vencidos (barrida)', () => {
  const desdeOriginal = process.env.APARTADOS_DESDE;
  beforeEach(() => {
    process.env.APARTADOS_DESDE = '2026-10-01T00:00:00.000-06:00';
    inventario.incrementarStockPorLineas.mockClear();
  });
  afterAll(() => {
    process.env.APARTADOS_DESDE = desdeOriginal;
  });

  it('sin APARTADOS_DESDE la regla no corre: ni una consulta', async () => {
    delete process.env.APARTADOS_DESDE;
    const { servicio, prisma, pedidos } = montar([apartado({})]);
    expect(await servicio.barrer(AHORA)).toEqual({ desactivada: true });
    expect(prisma.pedido.findMany).not.toHaveBeenCalled();
    expect(pedidos[0].estado).toBe('pendiente_pago');
  });

  it('con una fecha inválida tampoco corre', async () => {
    process.env.APARTADOS_DESDE = 'mañana';
    const { servicio, prisma } = montar([apartado({})]);
    expect(await servicio.barrer(AHORA)).toEqual({ desactivada: true });
    expect(prisma.pedido.findMany).not.toHaveBeenCalled();
  });

  it('un pedido creado antes de APARTADOS_DESDE nunca se cancela, aunque tenga 30 días', async () => {
    const viejos = [
      apartado({ id: 1, creadoEn: new Date('2026-09-20T12:00:00.000Z') }),
      apartado({ id: 2, metodoPago: 'mercado_pago', creadoEn: new Date('2026-09-20T12:00:00.000Z') }),
      apartado({ id: 3, estado: EstadoPedido.listo_recoger, creadoEn: new Date('2026-09-20T12:00:00.000Z'), listoDesde: hace(10 * DIA) }),
    ];
    const { servicio, pedidos, eventos } = montar(viejos);
    await servicio.barrer(AHORA);
    expect(pedidos.map((p) => p.estado)).toEqual(['pendiente_pago', 'pendiente_pago', 'listo_recoger']);
    expect(eventos.emit).not.toHaveBeenCalled();
    expect(inventario.incrementarStockPorLineas).not.toHaveBeenCalled();
  });

  it('apartado de 3 días sin preparar: se cancela, devuelve el stock, queda en el historial y avisa', async () => {
    const { servicio, pedidos, historial, eventos } = montar([apartado({ creadoEn: hace(3 * DIA + HORA) })]);
    await servicio.barrer(AHORA);
    expect(pedidos[0].estado).toBe('cancelado');
    expect(inventario.incrementarStockPorLineas).toHaveBeenCalledWith(expect.anything(), [{ presentacionId: 3, cantidad: 2 }], expect.objectContaining({ referenciaId: '1', motivo: 'apartado_vencido' }));
    expect(historial).toEqual([expect.objectContaining({ pedidoId: 1, estadoAnterior: 'pendiente_pago', estadoNuevo: 'cancelado', origen: 'sistema.apartado_vencido' })]);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.vencido', { pedidoId: 1, usuarioId: 'clienta-1', motivo: 'apartado_sin_preparar' });
  });

  it('apartado de 2 días: todavía no', async () => {
    const { servicio, pedidos } = montar([apartado({ creadoEn: hace(2 * DIA) })]);
    await servicio.barrer(AHORA);
    expect(pedidos[0].estado).toBe('pendiente_pago');
  });

  it('pago en línea sin pagar: a las 23 h no se cancela, a las 25 h sí, con stock devuelto', async () => {
    const { servicio, pedidos, eventos } = montar([
      apartado({ id: 1, metodoPago: 'mercado_pago', creadoEn: hace(23 * HORA) }),
      apartado({ id: 2, metodoPago: 'mercado_pago', creadoEn: hace(25 * HORA) }),
    ]);
    await servicio.barrer(AHORA);
    expect(pedidos.map((p) => p.estado)).toEqual(['pendiente_pago', 'cancelado']);
    expect(inventario.incrementarStockPorLineas).toHaveBeenCalledTimes(1);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.vencido', { pedidoId: 2, usuarioId: 'clienta-1', motivo: 'pago_en_linea_vencido' });
  });

  it('un pedido en línea ya pagado nunca se cancela', async () => {
    const { servicio, pedidos } = montar([apartado({ metodoPago: 'mercado_pago', estado: EstadoPedido.pagado, creadoEn: hace(5 * DIA) })]);
    await servicio.barrer(AHORA);
    expect(pedidos[0].estado).toBe('pagado');
  });

  it('listo para recoger hace 3 días: un recordatorio; la siguiente barrida no lo repite', async () => {
    const pedido = apartado({ estado: EstadoPedido.listo_recoger, listoDesde: hace(3 * DIA + HORA) });
    const primera = montar([pedido]);
    await primera.servicio.barrer(AHORA);
    expect(primera.eventos.emit).toHaveBeenCalledWith('pedido.recordatorio_recoger', { pedidoId: 1, usuarioId: 'clienta-1' });
    expect(pedido.estado).toBe('listo_recoger');

    const segunda = montar([pedido], [{ entidadId: '1', tipo: 'pedido_recordatorio_recoger' }]);
    await segunda.servicio.barrer(AHORA);
    expect(segunda.eventos.emit).not.toHaveBeenCalled();
  });

  it('listo para recoger hace 7 días: se cancela con stock devuelto y aviso', async () => {
    const { servicio, pedidos, eventos } = montar([apartado({ estado: EstadoPedido.listo_recoger, listoDesde: hace(7 * DIA + HORA) })]);
    await servicio.barrer(AHORA);
    expect(pedidos[0].estado).toBe('cancelado');
    expect(inventario.incrementarStockPorLineas).toHaveBeenCalledTimes(1);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.vencido', { pedidoId: 1, usuarioId: 'clienta-1', motivo: 'no_recogido' });
  });

  it('si el pedido cambió entre la lectura y la transacción (se pagó o entregó), no se toca nada', async () => {
    const pedido = apartado({ creadoEn: hace(4 * DIA) });
    const { servicio, prisma, historial, eventos } = montar([pedido]);
    // El personal lo marca en preparación justo después de la lectura de la barrida.
    const leer = prisma.pedido.findMany.getMockImplementation()!;
    prisma.pedido.findMany.mockImplementationOnce(async (args: any) => {
      const filas = await leer(args);
      pedido.estado = EstadoPedido.preparando;
      return filas;
    });
    await servicio.barrer(AHORA);
    expect(pedido.estado).toBe('preparando');
    expect(inventario.incrementarStockPorLineas).not.toHaveBeenCalled();
    expect(historial).toHaveLength(0);
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it('APARTADOS_DESDE como día (YYYY-MM-DD) cuenta desde el inicio de ese día en México', async () => {
    process.env.APARTADOS_DESDE = '2026-10-15';
    const { servicio, pedidos } = montar([
      apartado({ id: 1, creadoEn: new Date('2026-10-15T05:59:00.000Z') }), // 14 oct 23:59 en México
      apartado({ id: 2, creadoEn: new Date('2026-10-15T06:01:00.000Z') }), // 15 oct 00:01 en México
    ]);
    await servicio.barrer(AHORA);
    expect(pedidos.map((p) => p.estado)).toEqual(['pendiente_pago', 'cancelado']);
  });
});
