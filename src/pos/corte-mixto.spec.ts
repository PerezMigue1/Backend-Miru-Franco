import { Prisma } from '@prisma/client';
import { PosService } from './pos.service';

/** Los pagos mixtos entran al desglose del corte con los montos que se registraron al cobrar. */
describe('Corte de caja con pagos mixtos', () => {
  it('reparte la venta mixta en efectivo, tarjeta y transferencia, y la diferencia cuenta su efectivo', async () => {
    const d = (n: number) => new Prisma.Decimal(n);
    const ventas = [
      { id: 1, total: d(100), metodoPago: 'efectivo', montoEfectivo: null, montoTarjeta: null, montoTransferencia: null },
      { id: 2, total: d(500), metodoPago: 'mixto', montoEfectivo: d(200), montoTarjeta: d(250), montoTransferencia: d(50) },
      { id: 3, total: d(80), metodoPago: 'tarjeta', montoEfectivo: null, montoTarjeta: null, montoTransferencia: null },
    ];
    const creados: any[] = [];
    const prisma: any = {
      pago: { findMany: jest.fn(async () => []) },
      ventaLocal: { findMany: jest.fn(async () => ventas) },
      corteCaja: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          corteCaja: { create: jest.fn(async ({ data }: any) => (creados.push(data), { id: 1, ...data })) },
          ventaLocal: { updateMany: jest.fn(async () => ({ count: 3 })) },
          pago: { updateMany: jest.fn(async () => ({ count: 0 })) },
        }),
      ),
    };
    const pos = new PosService(prisma, {} as any, { emit: jest.fn() } as any);
    // Efectivo esperado en caja: 100 + 200 del mixto = 300.
    await pos.crearCorte({ fecha: '2026-10-04', efectivoInicial: 0, efectivoFinal: 300 } as any, 'caj-1');
    const c = creados[0];
    expect([c.totalVentas, c.totalEfectivo, c.totalTarjeta, c.totalTransferencia, c.diferencia].map(Number)).toEqual([680, 300, 330, 50, 0]);
    expect(prisma.ventaLocal.findMany.mock.calls[0][0].select).toMatchObject({ montoEfectivo: true, montoTarjeta: true, montoTransferencia: true });
  });
});

describe('Corte de caja con anticipos de citas', () => {
  it('el anticipo cobrado en el salón entra una sola vez (por pagos) y la venta solo trae el saldo', async () => {
    const d = (n: number) => new Prisma.Decimal(n);
    // Cita de $900 con anticipo de $150 en efectivo: el POS cobró $750 (anticipo guardado aparte en la venta).
    const ventas = [{ id: 1, total: d(750), anticipo: d(150), metodoPago: 'efectivo', montoEfectivo: null, montoTarjeta: null, montoTransferencia: null }];
    const pagos = [{ id: 9, citaId: 40, pedidoId: null, monto: d(150), metodo: 'efectivo', estado: 'aprobado', cobradoPorId: 'caj-1' }];
    const creados: any[] = [];
    const prisma: any = {
      pago: { findMany: jest.fn(async () => pagos) },
      ventaLocal: { findMany: jest.fn(async () => ventas) },
      corteCaja: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          corteCaja: { create: jest.fn(async ({ data }: any) => (creados.push(data), { id: 1, ...data })) },
          ventaLocal: { updateMany: jest.fn(async () => ({ count: 1 })) },
          pago: { updateMany: jest.fn(async () => ({ count: 1 })) },
        }),
      ),
    };
    const pos = new PosService(prisma, {} as any, { emit: jest.fn() } as any);
    await pos.crearCorte({ fecha: '2026-10-20', efectivoInicial: 0, efectivoFinal: 900 } as any, 'caj-1');
    const c = creados[0];
    expect([c.totalVentas, c.totalEfectivo, c.diferencia].map(Number)).toEqual([900, 900, 0]);
    // Un anticipo cobrado en el salón que pasa a revisión (la clienta canceló) sigue en caja: el corte lo cuenta.
    expect(prisma.pago.findMany.mock.calls[0][0].where.OR).toEqual([{ estado: 'aprobado' }, { estado: 'en_revision', citaId: { not: null } }]);
  });
});
