import { ConflictException } from '@nestjs/common';
import { PagosService } from './pagos.service';

function montar(pagoExistente?: Record<string, unknown>) {
  const creados: Record<string, any>[] = [];
  const actualizados: Record<string, any>[] = [];
  const prisma = {
    pedido: { findUnique: jest.fn(async () => ({ usuarioId: 'clienta-1' })) },
    pago: {
      create: jest.fn(async ({ data }: any) => (creados.push(data), { id: 1, ...data })),
      findUnique: jest.fn(async () => pagoExistente ?? null),
      update: jest.fn(async ({ data }: any) => (actualizados.push(data), { ...pagoExistente, ...data })),
    },
  };
  const servicio = new PagosService(prisma as any, { getRol: jest.fn() } as any);
  return { servicio, creados, actualizados };
}

const base = { pedidoId: 7, intentoNumero: 1, monto: 350 };

describe('Cobro registrado para el corte de caja', () => {
  it('un pago creado ya aprobado guarda cuándo se cobró y quién cobró', async () => {
    const { servicio, creados } = montar();
    await servicio.crear('cajera-1', { ...base, metodo: 'transferencia', estado: 'aprobado' } as any, 'estilista', ['caja:escritura']);
    expect(creados[0]).toMatchObject({ metodo: 'transferencia', estado: 'aprobado', cobradoPorId: 'cajera-1' });
    expect(creados[0].pagadoEn).toBeInstanceOf(Date);
  });

  it('un pago pendiente no se marca como cobrado', async () => {
    const { servicio, creados } = montar();
    await servicio.crear('cajera-1', { ...base, metodo: 'efectivo' } as any, 'estilista', ['caja:escritura']);
    expect(creados[0].pagadoEn).toBeUndefined();
    expect(creados[0].cobradoPorId).toBeUndefined();
  });

  it('aprobar un pago existente guarda la fecha, quién cobró y el método elegido', async () => {
    const { servicio, actualizados } = montar({ id: 5, pedidoId: 7, estado: 'pendiente', pagadoEn: null, metodo: 'tarjeta_debito' });
    await servicio.actualizar(5, 'cajera-1', { estado: 'aprobado', metodo: 'efectivo' } as any, 'estilista', ['caja:escritura']);
    expect(actualizados[0]).toMatchObject({ estado: 'aprobado', metodo: 'efectivo', cobradoPorId: 'cajera-1' });
    expect(actualizados[0].pagadoEn).toBeInstanceOf(Date);
  });

  it('un pago que ya tenía fecha de cobro no la pierde', async () => {
    const cobrado = new Date('2026-10-01T15:00:00.000Z');
    const { servicio, actualizados } = montar({ id: 5, pedidoId: 7, estado: 'pendiente', pagadoEn: cobrado, cobradoPorId: 'otra' });
    await servicio.actualizar(5, 'cajera-1', { estado: 'aprobado' } as any, 'estilista', ['caja:escritura']);
    expect(actualizados[0].pagadoEn).toBeUndefined();
    expect(actualizados[0].cobradoPorId).toBeUndefined();
  });
});

describe('Reembolsar un pago de pedido que ya tiene reembolsos por devolución', () => {
  function montarReembolso(devolucionesAprobadas: number) {
    const pago = { id: 5, pedidoId: 7, estado: 'aprobado', monto: 350, metodo: 'tarjeta_terminal', cobradoPorId: 'cajera-1' };
    const prisma: any = {
      pedido: { findUnique: jest.fn(async () => ({ usuarioId: 'clienta-1' })) },
      pago: {
        findUnique: jest.fn(async () => pago),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      devolucion: { count: jest.fn(async () => devolucionesAprobadas) },
      movimientoCaja: { create: jest.fn() },
      $executeRaw: jest.fn(async () => 1),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    return { servicio: new PagosService(prisma, { getRol: jest.fn() } as any), prisma };
  }

  it('responde 409 y no marca el pago como reembolsado, para que el dinero no salga dos veces', async () => {
    const { servicio, prisma } = montarReembolso(1);
    await expect(servicio.actualizar(5, 'cajera-2', { estado: 'reembolsado' } as any, 'estilista', ['caja:escritura'])).rejects.toThrow(
      'El pedido ya tiene reembolsos por devolución; gestiona desde devoluciones',
    );
    expect(prisma.pago.updateMany).not.toHaveBeenCalled();
  });

  it('sin devoluciones aprobadas de reembolso, se reembolsa como antes', async () => {
    const { servicio, prisma } = montarReembolso(0);
    await servicio.actualizar(5, 'cajera-2', { estado: 'reembolsado' } as any, 'estilista', ['caja:escritura']);
    expect(prisma.pago.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.devolucion.count.mock.calls[0][0].where).toEqual({ pedidoId: 7, estado: 'aprobada', tipo: 'reembolso' });
  });
});

describe('Cambiar el monto de un pago ya cobrado', () => {
  const caja: [string, string[]] = ['estilista', ['caja:escritura']];

  it.each([
    ['aprobado', { estado: 'aprobado', corteId: null }],
    ['reembolsado', { estado: 'reembolsado', corteId: null }],
    ['en revisión (Mercado Pago ya lo capturó)', { estado: 'en_revision', corteId: null }],
    ['incluido en un corte', { estado: 'pendiente', corteId: 12 }],
  ])('%s: cambiar el monto responde 409 y no se guarda nada', async (_caso, extra) => {
    const { servicio, actualizados } = montar({ id: 5, pedidoId: 7, monto: 350, pagadoEn: null, ...extra });
    const intento = servicio.actualizar(5, 'cajera-1', { monto: 3500 } as any, ...caja);
    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(servicio.actualizar(5, 'cajera-1', { monto: 3500 } as any, ...caja)).rejects.toThrow(
      'No se puede cambiar el monto de un pago ya cobrado, reembolsado o incluido en un corte de caja',
    );
    expect(actualizados).toHaveLength(0);
  });

  it('un pago aprobado acepta el mismo monto (la web reenvía el total del pedido al cobrar)', async () => {
    const { servicio, actualizados } = montar({ id: 5, pedidoId: 7, estado: 'aprobado', corteId: null, monto: '350.00', pagadoEn: new Date() });
    await servicio.actualizar(5, 'cajera-1', { estado: 'aprobado', monto: 350, metodo: 'efectivo' } as any, ...caja);
    expect(actualizados).toHaveLength(1);
  });

  it('un pago pendiente sin corte sigue pudiendo cambiar de monto', async () => {
    const { servicio, actualizados } = montar({ id: 5, pedidoId: 7, estado: 'pendiente', corteId: null, monto: 300, pagadoEn: null });
    await servicio.actualizar(5, 'cajera-1', { estado: 'aprobado', monto: 350 } as any, ...caja);
    expect(actualizados[0]).toMatchObject({ monto: 350, estado: 'aprobado' });
  });
});
