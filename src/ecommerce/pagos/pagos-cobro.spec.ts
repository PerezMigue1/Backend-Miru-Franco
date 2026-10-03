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
