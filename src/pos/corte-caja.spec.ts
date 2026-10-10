import { PosService, diaDelCorte } from './pos.service';

type Cobro = { id: number; pagadoEn: string; metodo: string; monto: number; estado?: string; cobradoPorId: string | null; corteId?: number | null; citaId?: number | null };

/** Prisma en memoria: ventas y cobros se filtran como lo haría la base (gte/lte, cajera, sin corte). */
function prismaConVentas(ventas: { id: number; creadoEn: string; metodoPago: string; total: number }[], cobros: Cobro[] = []) {
  const creados: Record<string, unknown>[] = [];
  const vinculadas: number[] = [];
  const cobrosVinculados: number[] = [];
  const filtrarCobros = (where: any) =>
    cobros.filter((c) => {
      const t = new Date(c.pagadoEn).getTime();
      return (
        (where.OR
          ? where.OR.some((o: any) => (c.estado ?? 'aprobado') === o.estado && (!o.citaId || (c.citaId ?? null) !== null))
          : (c.estado ?? 'aprobado') === where.estado) &&
        (where.cobradoPorId === undefined ||
          (typeof where.cobradoPorId === 'object' ? c.cobradoPorId !== null : c.cobradoPorId === where.cobradoPorId)) &&
        (where.corteId === undefined || (c.corteId ?? null) === where.corteId) &&
        where.metodo.in.includes(c.metodo) &&
        (!where.pagadoEn || (t >= where.pagadoEn.gte.getTime() && t <= where.pagadoEn.lte.getTime()))
      );
    });
  const prisma = {
    pago: {
      findMany: jest.fn(async ({ where }: any) => filtrarCobros(where).map((c) => ({ id: c.id, monto: c.monto, metodo: c.metodo }))),
    },
    ventaLocal: {
      findMany: jest.fn(async ({ where }: { where: { creadoEn: { gte: Date; lte: Date } } }) =>
        ventas
          .filter((v) => {
            const t = new Date(v.creadoEn).getTime();
            return t >= where.creadoEn.gte.getTime() && t <= where.creadoEn.lte.getTime();
          })
          .map((v) => ({ id: v.id, total: v.total, metodoPago: v.metodoPago })),
      ),
    },
    corteCaja: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    movimientoCaja: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const tx = {
        corteCaja: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (creados.push(data), { id: 1, ...data })) },
        ventaLocal: { updateMany: jest.fn(async ({ where }: { where: { id: { in: number[] } } }) => vinculadas.push(...where.id.in)) },
        pago: {
          updateMany: jest.fn(async ({ where, data }: any) => {
            // Como la base: solo los que siguen sin corte si el where lo pide.
            const elegibles = cobros.filter((c) => where.id.in.includes(c.id) && (where.corteId !== null || (c.corteId ?? null) === null));
            for (const c of elegibles) c.corteId = data.corteId;
            cobrosVinculados.push(...elegibles.map((c) => c.id));
            return { count: elegibles.length };
          }),
        },
      };
      return (arg as (t: typeof tx) => unknown)(tx);
    }),
  };
  return { prisma, creados, vinculadas, cobrosVinculados };
}

const servicioCon = (prisma: unknown) => new PosService(prisma as any, {} as any, { emit: jest.fn() } as any);

describe('Corte de caja por día de México', () => {
  const ventas = [
    { id: 1, creadoEn: '2026-10-03T16:00:00.000Z', metodoPago: 'efectivo', total: 100 }, // 3 oct 10:00
    { id: 2, creadoEn: '2026-10-04T05:30:00.000Z', metodoPago: 'efectivo', total: 250 }, // 3 oct 23:30
    { id: 3, creadoEn: '2026-10-04T06:10:00.000Z', metodoPago: 'tarjeta', total: 80 }, // 4 oct 00:10
    { id: 4, creadoEn: '2026-10-03T05:00:00.000Z', metodoPago: 'efectivo', total: 40 }, // 2 oct 23:00
  ];

  it('una venta a las 23:30 del día 3 entra en el corte del día 3; la de las 00:10 del 4, no', async () => {
    const { prisma, creados, vinculadas } = prismaConVentas(ventas);

    await servicioCon(prisma).crearCorte({ fecha: '2026-10-03', efectivoInicial: 0, efectivoFinal: 350 }, 'cajero-1');

    expect(vinculadas.sort()).toEqual([1, 2]);
    expect(Number(creados[0].totalVentas)).toBe(350);
    // El valor guardado del corte no cambia: el día a medianoche UTC, como antes.
    expect((creados[0].fecha as Date).toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('la venta de las 00:10 del día 4 entra en el corte del día 4', async () => {
    const { prisma, vinculadas } = prismaConVentas(ventas);

    await servicioCon(prisma).crearCorte({ fecha: '2026-10-04', efectivoInicial: 0, efectivoFinal: 0 }, 'cajero-1');

    expect(vinculadas).toEqual([3]);
  });

  it('una fecha con hora se toma como su día en México, no cortando el texto (día UTC)', () => {
    expect(diaDelCorte('2026-10-03')).toBe('2026-10-03');
    expect(diaDelCorte('2026-10-04T02:00:00.000Z')).toBe('2026-10-03'); // 3 oct 20:00 en México
  });

  it('un día imposible (2026-02-30) responde 400 en vez de cortar otro día', async () => {
    const { prisma } = prismaConVentas(ventas);

    await expect(
      servicioCon(prisma).crearCorte({ fecha: '2026-02-30', efectivoInicial: 0, efectivoFinal: 0 }, 'cajero-1'),
    ).rejects.toThrow('Fecha inválida');
    expect(prisma.ventaLocal.findMany).not.toHaveBeenCalled();
  });

  it('el listado de cortes filtra CorteCaja.fecha por el mismo día con el que se guarda', async () => {
    const { prisma } = prismaConVentas([]);

    await servicioCon(prisma).listarCortes({ desde: '2026-10-03', hasta: '2026-10-03' } as any);

    const where = (prisma.corteCaja.count.mock.calls[0] as unknown as [{ where: { fecha: { gte: Date; lte: Date } } }])[0].where;
    expect(where.fecha.gte.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(where.fecha.lte.toISOString()).toBe('2026-10-03T23:59:59.999Z');
  });
});

describe('El corte de caja suma los cobros de pedidos en el salón', () => {
  const ventas = [{ id: 1, creadoEn: '2026-10-03T16:00:00.000Z', metodoPago: 'efectivo', total: 100 }];
  const cobros = (): Cobro[] => [
    { id: 11, pagadoEn: '2026-10-04T02:00:00.000Z', metodo: 'efectivo', monto: 200, cobradoPorId: 'cajero-1' }, // 3 oct 20:00
    { id: 12, pagadoEn: '2026-10-03T18:00:00.000Z', metodo: 'tarjeta_terminal', monto: 300, cobradoPorId: 'cajero-1' },
    { id: 13, pagadoEn: '2026-10-03T19:00:00.000Z', metodo: 'transferencia', monto: 50, cobradoPorId: 'cajero-1' },
    { id: 14, pagadoEn: '2026-10-03T19:00:00.000Z', metodo: 'efectivo', monto: 999, cobradoPorId: 'otra-cajera' },
    { id: 15, pagadoEn: '2026-10-03T19:00:00.000Z', metodo: 'mercado_pago', monto: 400, cobradoPorId: null },
    { id: 16, pagadoEn: '2026-10-04T07:00:00.000Z', metodo: 'efectivo', monto: 70, cobradoPorId: 'cajero-1' }, // 4 oct 01:00
    { id: 17, pagadoEn: '2026-10-03T19:00:00.000Z', metodo: 'efectivo', monto: 80, cobradoPorId: 'cajero-1', estado: 'en_revision' },
  ];

  it('el anticipo de una cita cobrado en el salón sigue en el corte aunque pase a revisión (el de un pedido no)', async () => {
    const conAnticipo: Cobro[] = [...cobros(), { id: 18, pagadoEn: '2026-10-03T20:00:00.000Z', metodo: 'efectivo', monto: 150, cobradoPorId: 'cajero-1', estado: 'en_revision', citaId: 7 }];
    const { prisma, creados, cobrosVinculados } = prismaConVentas(ventas, conAnticipo);
    await servicioCon(prisma).crearCorte({ fecha: '2026-10-03', efectivoInicial: 500, efectivoFinal: 940 }, 'cajero-1');
    expect(Number(creados[0].totalEfectivo)).toBe(450);
    expect(cobrosVinculados.sort((a, b) => a - b)).toEqual([11, 12, 13, 18]);
  });

  it('efectivo, tarjeta en terminal y transferencia de esa cajera ese día van cada uno a su total', async () => {
    const { prisma, creados, cobrosVinculados } = prismaConVentas(ventas, cobros());

    await servicioCon(prisma).crearCorte({ fecha: '2026-10-03', efectivoInicial: 500, efectivoFinal: 790 }, 'cajero-1');

    expect(Number(creados[0].totalEfectivo)).toBe(300);
    expect(Number(creados[0].totalTarjeta)).toBe(300);
    expect(Number(creados[0].totalTransferencia)).toBe(50);
    expect(Number(creados[0].totalVentas)).toBe(650);
    // 790 contados - (500 inicial + 300 en efectivo) = -10
    expect(Number(creados[0].diferencia)).toBe(-10);
    expect(cobrosVinculados.sort()).toEqual([11, 12, 13]);
  });

  it('un cobro ya incluido en un corte no se vuelve a sumar', async () => {
    const lista = cobros();
    const primero = prismaConVentas(ventas, lista);
    await servicioCon(primero.prisma).crearCorte({ fecha: '2026-10-03', efectivoInicial: 0, efectivoFinal: 0 }, 'cajero-1');
    const segundo = prismaConVentas([], lista);
    await servicioCon(segundo.prisma).crearCorte({ fecha: '2026-10-03', efectivoInicial: 0, efectivoFinal: 0 }, 'cajero-1');
    expect(Number(segundo.creados[0].totalVentas)).toBe(0);
    expect(segundo.cobrosVinculados).toEqual([]);
  });

  it('si otro corte se llevó un cobro entre la lectura y el guardado, este corte se rechaza (409) en vez de contarlo dos veces', async () => {
    const lista = cobros();
    const { prisma, creados } = prismaConVentas(ventas, lista);
    const leer = prisma.pago.findMany.getMockImplementation()!;
    prisma.pago.findMany.mockImplementationOnce(async (args: any) => {
      const filas = await leer(args);
      lista.find((c) => c.id === 11)!.corteId = 99; // otro corte simultáneo lo tomó
      return filas;
    });
    await expect(servicioCon(prisma).crearCorte({ fecha: '2026-10-03', efectivoInicial: 0, efectivoFinal: 0 }, 'cajero-1')).rejects.toMatchObject({ status: 409 });
    expect(creados).toHaveLength(1); // se intentó dentro de la transacción, que se revierte
  });

  it('el resumen de ventas por método también incluye los cobros del salón', async () => {
    const { prisma } = prismaConVentas(ventas, cobros());
    const r = await servicioCon(prisma).resumen('2026-10-03', '2026-10-03');
    expect(Number(r.data.porMetodo.efectivo)).toBe(100 + 200 + 999);
    expect(Number(r.data.porMetodo.tarjeta)).toBe(300);
    expect(Number(r.data.porMetodo.transferencia)).toBe(50);
  });
});
