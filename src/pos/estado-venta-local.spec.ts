import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { EstadoVentaLocal } from '@prisma/client';
import { ListVentasDto } from './dto/list-ventas.dto';
import { PosService } from './pos.service';

/** El enum en la base es exactamente pendiente | pagada | cancelada: nada de 'abierta'. */
describe('EstadoVentaLocal: solo pendiente, pagada y cancelada', () => {
  it('el enum de Prisma tiene exactamente esos tres valores', () => {
    expect(Object.values(EstadoVentaLocal)).toEqual(['pendiente', 'pagada', 'cancelada']);
  });

  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validar = (estado: string) => pipe.transform({ estado }, { type: 'query', metatype: ListVentasDto });

  it('GET /api/pos/ventas?estado=abierta responde 400', async () => {
    await expect(validar('abierta')).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar('cerrada')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(Object.values(EstadoVentaLocal))('acepta ?estado=%s', async (estado) => {
    await expect(validar(estado)).resolves.toMatchObject({ estado });
  });

  it('el corte de caja solo suma y vincula ventas pagadas (no pendientes ni canceladas)', async () => {
    const ventas = [
      { id: 1, creadoEn: '2026-10-03T16:00:00.000Z', metodoPago: 'efectivo', total: 100, estado: 'pagada' },
      { id: 2, creadoEn: '2026-10-03T17:00:00.000Z', metodoPago: 'efectivo', total: 500, estado: 'cancelada' },
      { id: 3, creadoEn: '2026-10-03T18:00:00.000Z', metodoPago: 'tarjeta', total: 70, estado: 'pendiente' },
      { id: 4, creadoEn: '2026-10-03T19:00:00.000Z', metodoPago: 'tarjeta', total: 30, estado: 'pagada' },
    ];
    const creados: Record<string, unknown>[] = [];
    const vinculadas: number[] = [];
    const filtroVentas: unknown[] = [];
    const prisma: any = {
      pago: { findMany: jest.fn(async () => []) },
      ventaLocal: {
        findMany: jest.fn(async ({ where }: any) => {
          filtroVentas.push(where.estado);
          return ventas
            .filter((v) => (where.estado === undefined || v.estado === where.estado))
            .filter((v) => {
              const t = new Date(v.creadoEn).getTime();
              return t >= where.creadoEn.gte.getTime() && t <= where.creadoEn.lte.getTime();
            })
            .map((v) => ({ id: v.id, total: v.total, metodoPago: v.metodoPago }));
        }),
      },
      corteCaja: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      movimientoCaja: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (arg: any) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg({
          corteCaja: { create: jest.fn(async ({ data }: any) => (creados.push(data), { id: 1, ...data })) },
          ventaLocal: { updateMany: jest.fn(async ({ where }: any) => vinculadas.push(...where.id.in)) },
          pago: { updateMany: jest.fn(async () => ({ count: 0 })) },
        });
      }),
    };
    const pos = new PosService(prisma, {} as any, { emit: jest.fn() } as any);
    await pos.crearCorte({ fecha: '2026-10-03', efectivoInicial: 0, efectivoFinal: 100 } as any, 'cajero-1');
    expect(filtroVentas).toEqual(['pagada']);
    expect(vinculadas.sort()).toEqual([1, 4]);
    expect(Number(creados[0].totalVentas)).toBe(130);
  });
});
