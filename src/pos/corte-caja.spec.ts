import { PosService, diaDelCorte } from './pos.service';

/** Prisma en memoria: las ventas se filtran como lo haría la base (gte/lte sobre creadoEn). */
function prismaConVentas(ventas: { id: number; creadoEn: string; metodoPago: string; total: number }[]) {
  const creados: Record<string, unknown>[] = [];
  const vinculadas: number[] = [];
  const prisma = {
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
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const tx = {
        corteCaja: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (creados.push(data), { id: 1, ...data })) },
        ventaLocal: { updateMany: jest.fn(async ({ where }: { where: { id: { in: number[] } } }) => vinculadas.push(...where.id.in)) },
      };
      return (arg as (t: typeof tx) => unknown)(tx);
    }),
  };
  return { prisma, creados, vinculadas };
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
