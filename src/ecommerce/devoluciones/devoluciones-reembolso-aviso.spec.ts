import { Prisma } from '@prisma/client';
import { EVENTO_REEMBOLSO_REALIZADO } from '../../notificaciones/eventos';
import { DevolucionesService } from './devoluciones.service';

/** Reembolso aprobado por devolución o por revocación de compra: la clienta recibe el aviso en vivo. */
const DATA_APROBADA = { id: 5, tipo: 'reembolso', monto: new Prisma.Decimal(120), pedido: { id: 42, usuarioId: 'cli-1' } };

function montarAprobar(tipo: 'reembolso' | 'cambio') {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    devolucion: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ id: 5, tipo, monto: tipo === 'reembolso' ? new Prisma.Decimal(120) : null, pedidoId: 42, origen: 'portal' })
        .mockResolvedValueOnce({ ...DATA_APROBADA, tipo }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { monto: null } }),
    },
    pago: { findFirst: jest.fn().mockResolvedValue(null) },
    pedido: { findUnique: jest.fn().mockResolvedValue({ total: new Prisma.Decimal(500) }) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const eventos = { emit: jest.fn() };
  return { servicio: new DevolucionesService(prisma, undefined, eventos as any), eventos };
}

describe('Aviso a la clienta del reembolso por devolución', () => {
  it('aprobar un reembolso emite el evento con la clienta, el pedido, el monto y la devolución', async () => {
    const { servicio, eventos } = montarAprobar('reembolso');
    await servicio.aprobar(5, 'empleada-1', {} as any);
    expect(eventos.emit).toHaveBeenCalledWith(EVENTO_REEMBOLSO_REALIZADO, {
      usuarioId: 'cli-1',
      entidadTipo: 'pedido',
      entidadId: 42,
      monto: 120,
      referencia: 'devolucion-5',
    });
  });

  it('aprobar un cambio (sin dinero) no avisa de reembolso', async () => {
    const { servicio, eventos } = montarAprobar('cambio');
    await servicio.aprobar(5, 'empleada-1', {} as any);
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it('recibir una revocación pagada en línea reembolsa y avisa a la clienta', async () => {
    const pago = { id: 9, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '777', monto: new Prisma.Decimal(350), metodo: 'mercado_pago' };
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      devolucion: {
        findUnique: jest.fn().mockResolvedValue({ estado: 'pendiente', monto: new Prisma.Decimal(350) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ monto: new Prisma.Decimal(350), pedidoItemId: null }]),
      },
      pedido: { findUnique: jest.fn().mockResolvedValue({ estado: 'cancelado', items: [] }) },
      pago: { findMany: jest.fn().mockResolvedValue([pago]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma: any = {
      devolucion: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 6, pedidoId: 42, origen: 'revocacion_art56' })
          .mockResolvedValue({ id: 6, monto: new Prisma.Decimal(350), pedido: { id: 42, usuarioId: 'cli-1' } }),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const mp = { reembolsarPago: jest.fn().mockResolvedValue({ id: 1 }), obtenerPago: jest.fn() };
    const eventos = { emit: jest.fn() };
    const servicio = new DevolucionesService(prisma, mp as any, eventos as any);
    await servicio.recibirRevocacion(6, 'empleada-1', {} as any);
    expect(eventos.emit).toHaveBeenCalledWith(EVENTO_REEMBOLSO_REALIZADO, {
      usuarioId: 'cli-1',
      entidadTipo: 'pedido',
      entidadId: 42,
      monto: 350,
      referencia: 'devolucion-6',
    });
  });
});
