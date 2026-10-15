import { BadGatewayException, BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EstadoPago } from '@prisma/client';
import { PERMISO_REEMBOLSOS, ReembolsosPendientesService } from './reembolsos-pendientes.service';
import { ReembolsosPendientesController } from './reembolsos-pendientes.controller';
import { PermisosGuard } from '../../common/guards/permisos.guard';

/**
 * Admin > Reembolsos pendientes: pagos en revisión ("reembolsar a mano", como el del pedido 3089 en producción).
 * "Reintentar reembolso" usa la misma clave de idempotencia que el primer intento (Mercado Pago no reembolsa dos
 * veces); "Marcar como reembolsado manualmente" exige la referencia. Todo queda en historial_reembolsos.
 */
function montar(pagoInicial: Record<string, unknown> | null = {}, devolucionesAprobadas = 0) {
  const pago = pagoInicial && {
    id: 3027,
    pedidoId: 3089,
    citaId: null as number | null,
    estado: EstadoPago.en_revision as EstadoPago,
    monto: 335,
    proveedor: 'mercadopago',
    referenciaExterna: '182714058919',
    errorMensaje: 'No se pudo reembolsar al cancelar la clienta: reembolsar a mano',
    reembolsadoEn: null as Date | null,
    ...pagoInicial,
  };
  const historial: Record<string, unknown>[] = [];
  const devolucion = { count: jest.fn(async () => devolucionesAprobadas) };
  const tx = {
    $executeRaw: jest.fn(async (..._args: unknown[]) => 1),
    devolucion,
    pago: {
      updateMany: jest.fn(async ({ where, data }: { where: { id: number; estado: EstadoPago }; data: Record<string, unknown> }) => {
        if (!pago || where.id !== pago.id || pago.estado !== where.estado) return { count: 0 };
        Object.assign(pago, data);
        return { count: 1 };
      }),
    },
    historialReembolso: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => historial.push(data)) },
  };
  const prisma = {
    pago: {
      findUnique: jest.fn(async () => (pago ? { ...pago, pedido: pago.pedidoId ? { usuarioId: 'cli-1' } : null, cita: pago.citaId ? { clienteId: 'cli-2' } : null } : null)),
      findMany: jest.fn(async () => (pago && pago.estado === EstadoPago.en_revision ? [{ ...pago, pedido: { id: 3089, estado: 'cancelado', usuario: { nombre: 'Ana' } }, cita: null, historialReembolsos: [] }] : [])),
    },
    historialReembolso: tx.historialReembolso,
    devolucion,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const mp = {
    reembolsarPago: jest.fn(async () => ({ id: 99887766, status: 'approved' })),
    obtenerPago: jest.fn(async () => ({ id: 182714058919, status: 'approved' })),
  };
  const eventos = { emit: jest.fn() };
  const servicio = new ReembolsosPendientesService(prisma as any, mp as any, eventos as any);
  return { servicio, pago, historial, mp, tx, eventos };
}

describe('Reembolsos pendientes', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('lista los pagos en revisión con el motivo, el pedido o la cita y su historial', async () => {
    const { servicio } = montar();
    const r = await servicio.listar();
    expect(r.data).toEqual([
      expect.objectContaining({ id: 3027, pedidoId: 3089, monto: 335, referenciaExterna: '182714058919', motivo: 'No se pudo reembolsar al cancelar la clienta: reembolsar a mano', clienta: 'Ana' }),
    ]);
  });

  it('reintentar: reembolsa con la MISMA clave del primer intento, marca reembolsado y lo deja en el historial', async () => {
    const { servicio, pago, historial, mp } = montar();
    await expect(servicio.reintentar(3027, 'admin-1')).resolves.toMatchObject({ estado: 'reembolsado' });
    expect(mp.reembolsarPago).toHaveBeenCalledWith('182714058919', 'reembolso-pedido-3027');
    expect(pago!.estado).toBe('reembolsado');
    expect(pago!.reembolsadoEn).toBeInstanceOf(Date);
    expect(historial).toEqual([expect.objectContaining({ pagoId: 3027, accion: 'reintento', referencia: '99887766', usuarioId: 'admin-1' })]);
  });

  it('al quedar reembolsado avisa a la clienta (evento reembolso.realizado), con reintento o a mano', async () => {
    const a = montar();
    await a.servicio.reintentar(3027, 'admin-1');
    expect(a.eventos.emit).toHaveBeenCalledWith('reembolso.realizado', { usuarioId: 'cli-1', entidadTipo: 'pedido', entidadId: 3089, monto: 335, referencia: 'pago-3027' });
    const b = montar({ pedidoId: null, citaId: 25 });
    await b.servicio.marcarManual(3027, { referencia: 'SPEI 1' }, 'admin-1');
    expect(b.eventos.emit).toHaveBeenCalledWith('reembolso.realizado', { usuarioId: 'cli-2', entidadTipo: 'cita', entidadId: 25, monto: 335, referencia: 'pago-3027' });
  });

  it('si Mercado Pago falla no se avisa a la clienta', async () => {
    const { servicio, mp, eventos } = montar();
    mp.reembolsarPago.mockRejectedValueOnce(new Error('500'));
    await servicio.reintentar(3027, 'admin-1').catch(() => undefined);
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it('reintentar un anticipo de cita usa su clave (reembolso-pago-<id>)', async () => {
    const { servicio, mp } = montar({ pedidoId: null, citaId: 25 });
    await servicio.reintentar(3027, 'admin-1');
    expect(mp.reembolsarPago).toHaveBeenCalledWith('182714058919', 'reembolso-pago-3027');
  });

  it('si Mercado Pago falla pero el pago ya figura reembolsado allá, cuenta como hecho', async () => {
    const { servicio, pago, mp } = montar();
    mp.reembolsarPago.mockRejectedValueOnce(new Error('400'));
    mp.obtenerPago.mockResolvedValueOnce({ id: 182714058919, status: 'refunded' });
    await expect(servicio.reintentar(3027, 'admin-1')).resolves.toMatchObject({ estado: 'reembolsado' });
    expect(pago!.estado).toBe('reembolsado');
  });

  it('si Mercado Pago falla: 502 en español, el pago sigue en revisión y el intento fallido queda en el historial', async () => {
    const { servicio, pago, historial, mp } = montar();
    mp.reembolsarPago.mockRejectedValueOnce(new Error('500'));
    await expect(servicio.reintentar(3027, 'admin-1')).rejects.toBeInstanceOf(BadGatewayException);
    expect(pago!.estado).toBe('en_revision');
    expect(historial).toEqual([expect.objectContaining({ accion: 'reintento_fallido', usuarioId: 'admin-1' })]);
  });

  it('Mercado Pago responde el reembolso sin aprobarlo (rechazado o en proceso): no se marca reembolsado, 502 y queda el intento fallido', async () => {
    for (const estado of ['rejected', 'in_process', 'pending']) {
      const { servicio, pago, historial, mp, eventos } = montar();
      mp.reembolsarPago.mockResolvedValueOnce({ id: 1, status: estado });
      await expect(servicio.reintentar(3027, 'admin-1')).rejects.toBeInstanceOf(BadGatewayException);
      expect(pago!.estado).toBe('en_revision');
      expect(historial).toEqual([expect.objectContaining({ accion: 'reintento_fallido' })]);
      expect(eventos.emit).not.toHaveBeenCalled();
    }
  });

  it('un pedido con reembolsos por devolución ya aprobados no se reintenta ni se marca a mano: 409 sin llamar a Mercado Pago', async () => {
    const { servicio, pago, mp, historial } = montar({}, 1);
    await expect(servicio.reintentar(3027, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(servicio.marcarManual(3027, { referencia: 'SPEI 1' }, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
    expect(pago!.estado).toBe('en_revision');
    expect(historial).toHaveLength(0);
  });

  it('al marcarlo toma el mismo candado de reembolsos del pedido que devoluciones y pagos', async () => {
    const { servicio, tx } = montar();
    await servicio.marcarManual(3027, { referencia: 'SPEI 2' }, 'admin-1');
    const valores = tx.$executeRaw.mock.calls.flatMap((c) => c.slice(1));
    expect(valores).toContain('reembolsos-pedido:3089');
  });

  it('un pago que no está en revisión (ya reembolsado) no se reintenta: 409 sin llamar a Mercado Pago', async () => {
    const { servicio, mp } = montar({ estado: EstadoPago.reembolsado });
    await expect(servicio.reintentar(3027, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
  });

  it('un pago sin referencia de Mercado Pago no se puede reintentar (se marca a mano)', async () => {
    const { servicio, mp } = montar({ referenciaExterna: null, proveedor: null });
    await expect(servicio.reintentar(3027, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
  });

  it('pago inexistente: 404', async () => {
    const { servicio } = montar(null);
    await expect(servicio.reintentar(1, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marcar como reembolsado manualmente: exige la referencia y guarda referencia y nota en el historial', async () => {
    const { servicio, pago, historial, tx } = montar();
    await expect(servicio.marcarManual(3027, { referencia: '  ', nota: 'x' }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.marcarManual(3027, { referencia: 'SPEI 4455', nota: 'Transferencia a la clienta' }, 'admin-1')).resolves.toMatchObject({ estado: 'reembolsado' });
    expect(pago!.estado).toBe('reembolsado');
    expect(historial).toEqual([expect.objectContaining({ accion: 'manual', referencia: 'SPEI 4455', nota: 'Transferencia a la clienta', usuarioId: 'admin-1' })]);
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('marcar a mano un pago que ya no está en revisión: 409 y no escribe historial', async () => {
    const { servicio, historial } = montar({ estado: EstadoPago.reembolsado });
    await expect(servicio.marcarManual(3027, { referencia: 'SPEI 1' }, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(historial).toHaveLength(0);
  });

  it('las rutas exigen sesión y el permiso reembolsos:gestionar (solo admin por omisión)', () => {
    expect(PERMISO_REEMBOLSOS).toBe('reembolsos:gestionar');
    const guardias = Reflect.getMetadata(GUARDS_METADATA, ReembolsosPendientesController) ?? [];
    expect(guardias).toContain(PermisosGuard);
    expect(Reflect.getMetadata('permisos', ReembolsosPendientesController)).toEqual(['reembolsos:gestionar']);
  });
});

describe('Cableado de Reembolsos pendientes', () => {
  it('EcommerceModule registra el controlador y el servicio', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EcommerceModule } = require('../ecommerce.module');
    expect(Reflect.getMetadata('controllers', EcommerceModule)).toContain(ReembolsosPendientesController);
    expect(Reflect.getMetadata('providers', EcommerceModule)).toContain(ReembolsosPendientesService);
  });
});
