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
