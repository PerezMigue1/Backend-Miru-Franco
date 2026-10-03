import { InventarioService } from './inventario.service';

const presentaciones = [
  { id: 1, fechaCaducidad: new Date('2026-10-03T12:00:00.000Z') }, // hoy (desde el formulario)
  { id: 2, fechaCaducidad: new Date('2026-10-04T00:00:00.000Z') }, // mañana (importada a medianoche)
  { id: 3, fechaCaducidad: new Date('2026-10-02T12:00:00.000Z') }, // ayer
];

function servicio() {
  const prisma = {
    productoPresentacion: {
      findMany: jest.fn(async () => presentaciones.map((p) => ({ ...p, tamanio: '1L', stock: 1, producto: null }))),
    },
  };
  return { prisma, servicio: new InventarioService(prisma as any) };
}

describe('Caducidades por día de calendario en México', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    ['08:00', '2026-10-03T14:00:00.000Z'],
    ['23:30', '2026-10-04T05:30:00.000Z'],
  ])('a las %s del 3 de octubre: hoy 0, mañana 1, ayer -1; solo lo de ayer está vencido', async (_hora, ahora) => {
    jest.useFakeTimers({ now: new Date(ahora) });
    const { servicio: s } = servicio();

    const { data } = await s.caducidades({ dias: 30 } as any);

    expect(data.map((p) => [p.id, p.diasRestantes, p.vencida])).toEqual([
      [1, 0, false],
      [2, 1, false],
      [3, -1, true],
    ]);
  });

  it('la ventana de "próximos N días" llega hasta el final del día hoy + N', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-04T05:30:00.000Z') }); // 3 oct 23:30 en México
    const { prisma, servicio: s } = servicio();

    await s.caducidades({ dias: 30 } as any);

    const llamada = prisma.productoPresentacion.findMany.mock.calls[0] as unknown as [{ where: { fechaCaducidad: { lte: Date } } }];
    const limite = llamada[0].where.fechaCaducidad.lte;
    expect(limite.toISOString()).toBe('2026-11-02T23:59:59.999Z'); // 3 oct + 30 días
  });
});
