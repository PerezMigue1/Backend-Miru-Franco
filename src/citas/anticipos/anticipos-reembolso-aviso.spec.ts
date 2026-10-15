import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EVENTO_REEMBOLSO_REALIZADO } from '../../notificaciones/eventos';
import { AnticiposCitasService } from './anticipos-citas.service';

/** Al reembolsar el anticipo de una cita, la clienta recibe el aviso en vivo (uno por pago reembolsado). */
function montar(pago: Record<string, unknown> | null, cita: Record<string, unknown> = { id: 7, estado: 'cancelada', clienteId: 'cli-1' }) {
  const tx = { pago: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const prisma: any = {
    cita: { findUnique: jest.fn().mockResolvedValue(cita) },
    pago: { findFirst: jest.fn().mockResolvedValue(pago) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const mp = { reembolsarPago: jest.fn().mockResolvedValue({ id: 1, status: 'approved' }), obtenerPago: jest.fn() };
  const eventos = { emit: jest.fn() };
  return { servicio: new AnticiposCitasService(prisma, mp as any, eventos as any), eventos, tx };
}

const pagoMp = { id: 31, citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555', monto: new Prisma.Decimal(150), metodo: 'mercado_pago' };

describe('Aviso a la clienta del reembolso de su anticipo', () => {
  it('reembolso hecho: emite el evento con la clienta, la cita, el monto y el pago', async () => {
    const { servicio, eventos } = montar(pagoMp);
    await servicio.reembolsar(7, 'estilista-1');
    expect(eventos.emit).toHaveBeenCalledWith(EVENTO_REEMBOLSO_REALIZADO, {
      usuarioId: 'cli-1',
      entidadTipo: 'cita',
      entidadId: 7,
      monto: 150,
      referencia: 'pago-31',
    });
  });

  it('si el reembolso no se guarda (ya estaba reembolsado) no avisa', async () => {
    const { servicio, eventos, tx } = montar(pagoMp);
    tx.pago.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(servicio.reembolsar(7, 'estilista-1')).rejects.toBeInstanceOf(ConflictException);
    expect(eventos.emit).not.toHaveBeenCalledWith(EVENTO_REEMBOLSO_REALIZADO, expect.anything());
  });
});
