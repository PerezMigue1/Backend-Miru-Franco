import { Prisma } from '@prisma/client';
import { ReportesService } from './reportes.service';

/**
 * Reporte de ingresos: el anticipo de una cita entra una sola vez (por la tabla pagos, el día en que se pagó)
 * y la venta del POS solo trae el saldo. Los anticipos en revisión y los reembolsados se muestran aparte.
 */
const d = (n: number) => new Prisma.Decimal(n);

function coincide(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return (cond as any[]).some((w) => coincide(fila, w));
    const v = fila[k];
    if (cond === null) return v === null || v === undefined;
    if (typeof cond !== 'object') return v === cond;
    return Object.entries(cond).every(([op, x]: [string, any]) => {
      const t = (z: any) => (z instanceof Date ? z.getTime() : z);
      switch (op) {
        case 'in': return (x as any[]).includes(v);
        case 'not': return x === null ? v !== null && v !== undefined : v !== x;
        case 'gte': return v != null && t(v) >= t(x);
        case 'lte': return v != null && t(v) <= t(x);
        default: throw new Error(`Operador no soportado en la prueba: ${op}`);
      }
    });
  });
}

function montar(ventas: any[], pagos: any[]) {
  const prisma: any = {
    ventaLocal: { findMany: jest.fn(async ({ where }: any) => ventas.filter((v) => coincide(v, where))) },
    ventaLocalItem: { findMany: jest.fn(async () => []) },
    pago: { findMany: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where))) },
  };
  const pos = { resumen: jest.fn(async () => ({ success: true, data: { totalVentas: 0, totalMonto: 0, porMetodo: {} } })) };
  return { servicio: new ReportesService(prisma, pos as any, {} as any), pos };
}

const OCT_2 = new Date('2026-10-02T18:00:00.000Z');
const OCT_3 = new Date('2026-10-03T18:00:00.000Z');
const pago = (extra: Record<string, unknown>) => ({
  pedidoId: null, citaId: null, estado: 'aprobado', cobradoPorId: null, pagadoEn: OCT_3, reembolsadoEn: null, retenidoEn: null, ...extra,
});

describe('Reporte de ingresos con anticipos de citas', () => {
  const ventas = [
    // Servicio de 900 con anticipo de 150 por Mercado Pago: el POS cobró 750 en efectivo el 3 de octubre.
    { id: 1, folio: 'VL-1', estado: 'pagada', total: d(750), anticipo: d(150), metodoPago: 'efectivo', creadoEn: OCT_3 },
    // Servicio de 700 con anticipo de 200 en efectivo en el salón: el POS cobró 500 con tarjeta.
    { id: 2, folio: 'VL-2', estado: 'pagada', total: d(500), anticipo: d(200), metodoPago: 'tarjeta', creadoEn: OCT_3 },
    { id: 3, folio: 'VL-3', estado: 'cancelada', total: d(999), anticipo: d(0), metodoPago: 'efectivo', creadoEn: OCT_3 },
  ];
  const pagos = [
    pago({ id: 1, citaId: 10, monto: d(150), metodo: 'mercado_pago', pagadoEn: OCT_2 }),
    pago({ id: 2, citaId: 11, monto: d(200), metodo: 'efectivo', cobradoPorId: 'cajera-1', pagadoEn: OCT_2 }),
    pago({ id: 3, citaId: 12, monto: d(150), metodo: 'mercado_pago', estado: 'reembolsado', pagadoEn: OCT_2, reembolsadoEn: OCT_3 }),
    pago({ id: 4, citaId: 13, monto: d(100), metodo: 'mercado_pago', estado: 'en_revision', pagadoEn: OCT_3 }),
  ];

  it('suma ventas del POS y anticipos sin contarlos dos veces; en revisión y reembolsados van aparte', async () => {
    const { servicio } = montar(ventas, pagos);
    const r = await servicio.ventas('2026-10-02', '2026-10-03');
    const i = r.data.ingresos;
    expect(Number(i.total)).toBe(1600); // 900 + 700
    expect(Number(i.ventasPos)).toBe(1250);
    expect(Number(i.anticipos)).toBe(350);
    expect(Number(i.anticiposEnLinea)).toBe(150);
    expect(Number(i.anticiposEnSalon)).toBe(200);
    expect(Number(i.cobrosPedidosSalon)).toBe(0);
    expect(Number(i.anticiposEnRevision)).toBe(100);
    expect(Number(i.anticiposReembolsados)).toBe(150);
  });

  it('un anticipo retenido es ingreso; un cobro de pedido en el salón suma como hoy', async () => {
    const { servicio } = montar([], [
      pago({ id: 5, citaId: 14, monto: d(150), metodo: 'mercado_pago', retenidoEn: OCT_3 }),
      pago({ id: 6, pedidoId: 20, monto: d(300), metodo: 'efectivo', cobradoPorId: 'cajera-1' }),
      pago({ id: 7, pedidoId: 21, monto: d(400), metodo: 'mercado_pago' }), // en línea: no es cobro del salón
    ]);
    const i = (await servicio.ventas('2026-10-03', '2026-10-03')).data.ingresos;
    expect(Number(i.anticipos)).toBe(150);
    expect(Number(i.cobrosPedidosSalon)).toBe(300);
    expect(Number(i.total)).toBe(450);
  });

  it('un anticipo pagado fuera del periodo no entra', async () => {
    const { servicio } = montar(ventas, pagos);
    const i = (await servicio.ventas('2026-10-03', '2026-10-03')).data.ingresos;
    expect(Number(i.anticipos)).toBe(0);
    expect(Number(i.total)).toBe(1250);
  });

  it('conserva el resumen y el listado que ya usa la web', async () => {
    const { servicio, pos } = montar(ventas, pagos);
    const r = await servicio.ventas('2026-10-02', '2026-10-03');
    expect(pos.resumen).toHaveBeenCalledWith('2026-10-02', '2026-10-03');
    expect(r.data.resumen).toMatchObject({ totalUnidadesVendidas: 0 });
    expect(r.data.ventas.map((v: any) => v.id)).toEqual([1, 2]);
  });
});
