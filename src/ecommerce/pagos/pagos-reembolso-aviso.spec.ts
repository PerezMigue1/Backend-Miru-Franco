import { Prisma } from '@prisma/client';
import { EVENTO_REEMBOLSO_REALIZADO } from '../../notificaciones/eventos';
import { PagosService } from './pagos.service';

/** Al reembolsar el pago de un pedido desde el panel, la clienta dueña del pedido recibe el aviso en vivo. */
function montar(actualizados = 1) {
  const pago = { id: 21, pedidoId: 42, estado: 'aprobado', monto: new Prisma.Decimal(350), metodo: 'mercado_pago', proveedor: 'mercadopago' };
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    devolucion: { count: jest.fn().mockResolvedValue(0) },
    pago: {
      updateMany: jest.fn().mockResolvedValue({ count: actualizados }),
      findUnique: jest.fn().mockResolvedValue({ ...pago, estado: 'reembolsado' }),
    },
  };
  const prisma: any = {
    pago: { findUnique: jest.fn().mockResolvedValue(pago) },
    pedido: { findUnique: jest.fn().mockResolvedValue({ usuarioId: 'cli-1' }) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const eventos = { emit: jest.fn() };
  return { servicio: new PagosService(prisma, { getRol: jest.fn() } as any, eventos as any), eventos };
}

describe('Aviso a la clienta del reembolso de su pedido', () => {
  it('reembolso guardado: emite el evento con la dueña del pedido, el monto y el pago', async () => {
    const { servicio, eventos } = montar();
    await servicio.actualizar(21, 'admin-1', { estado: 'reembolsado' } as any, 'admin');
    expect(eventos.emit).toHaveBeenCalledWith(EVENTO_REEMBOLSO_REALIZADO, {
      usuarioId: 'cli-1',
      entidadTipo: 'pedido',
      entidadId: 42,
      monto: 350,
      referencia: 'pago-21',
    });
  });

  it('si no se pudo reembolsar no avisa', async () => {
    const { servicio, eventos } = montar(0);
    await expect(servicio.actualizar(21, 'admin-1', { estado: 'reembolsado' } as any, 'admin')).rejects.toThrow();
    expect(eventos.emit).not.toHaveBeenCalled();
  });
});
