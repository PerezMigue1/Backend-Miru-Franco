import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { EstadoPedido } from '@prisma/client';
import { PedidosService } from './pedidos.service';

jest.mock('../common/pedido-inventario.util', () => ({
  cantidadPorPresentacion: jest.fn(() => new Map()),
  decrementarStockPresentaciones: jest.fn(async () => undefined),
  incrementarStockPorLineas: jest.fn(async () => undefined),
}));

const CLIENTA = 'clienta-1';

/** Un pedido y su pago en memoria; Mercado Pago simulado. */
function montar(
  pedido: { estado: EstadoPedido; metodoPago: string },
  opciones: { conPago?: boolean; devoluciones?: { id: number; pedidoId: number; estado: string }[] } = {},
) {
  const actual = { id: 7, usuarioId: CLIENTA, total: 350, pagadoEn: new Date('2026-10-10T17:00:00Z'), ...pedido };
  const pago = { id: 31, pedidoId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '987654', monto: 350 } as Record<string, unknown>;
  const pagos = opciones.conPago === false ? [] : [pago];
  const devoluciones = opciones.devoluciones ?? [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    devolucion: {
      findFirst: jest.fn(async ({ where }: any) =>
        devoluciones.find((d) => d.pedidoId === where.pedidoId && !where.estado.notIn.includes(d.estado)) ?? null,
      ),
    },
    pedidoItem: { findMany: jest.fn(async () => []) },
    pedido: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== actual.id || where.estado !== actual.estado) return { count: 0 };
        Object.assign(actual, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => ({
        ...actual,
        ...data,
        usuario: { id: CLIENTA, nombre: 'Ana López', email: 'ana@correo.mx' },
      })),
    },
    historialEstadoPedido: { create: jest.fn(async () => ({})) },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(async () => ({ ...actual })) },
    permisoRol: { findUnique: jest.fn(async () => ({ claves: [] })) },
    pago: {
      findFirst: jest.fn(async ({ where }: any) =>
        pagos.find((p) => p.pedidoId === where.pedidoId && p.estado === where.estado && p.proveedor === where.proveedor) ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const p = pagos.find((x) => x.id === where.id && x.estado === where.estado);
        if (!p) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = { getRol: jest.fn(async () => 'cliente'), isAdmin: () => false };
  const eventos = { emit: jest.fn() };
  const mercadoPago = {
    reembolsarPago: jest.fn(async () => ({ id: 1, status: 'approved' })),
    obtenerPago: jest.fn(async () => ({ id: 987654, status: 'approved' })),
  };
  const servicio = new PedidosService(prisma as any, access as any, eventos as any, mercadoPago as any);
  return { servicio, actual, pago, eventos, mercadoPago, prisma, tx };
}

const cancelar = (servicio: PedidosService) => servicio.actualizar(7, CLIENTA, { estado: EstadoPedido.cancelado }, true);

describe('La clienta cancela un pedido ya pagado con Mercado Pago', () => {
  it('se reembolsa completo con clave por pago, el pago queda reembolsado y se avisa al personal', async () => {
    const { servicio, actual, pago, eventos, mercadoPago } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' });

    const r = await cancelar(servicio);

    expect(actual.estado).toBe('cancelado');
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(pago).toMatchObject({ estado: 'reembolsado', errorMensaje: 'Reembolsado al cancelar la clienta' });
    expect(pago.reembolsadoEn).toBeInstanceOf(Date);
    expect(r).toMatchObject({ success: true, data: { id: 7, estado: 'cancelado' }, reembolso: { estado: 'reembolsado', monto: 350 } });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado', { pedidoId: 7, usuarioId: CLIENTA });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', {
      pedidoId: 7,
      usuarioId: CLIENTA,
      clienta: 'Ana López',
      monto: 350,
      reembolso: 'reembolsado',
    });
  });

  it('si Mercado Pago falla: el pedido queda cancelado, el pago en revisión y el aviso lo dice', async () => {
    const { servicio, actual, pago, eventos, mercadoPago } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' });
    mercadoPago.reembolsarPago.mockRejectedValueOnce(new ServiceUnavailableException('El pago en línea no está disponible por ahora.'));

    const r = await cancelar(servicio);

    expect(actual.estado).toBe('cancelado');
    expect(mercadoPago.obtenerPago).toHaveBeenCalledWith('987654');
    expect(pago.estado).toBe('en_revision');
    expect(pago.errorMensaje).toEqual(expect.any(String));
    expect(r).toMatchObject({ success: true, reembolso: { estado: 'en_revision', monto: 350 } });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', expect.objectContaining({ pedidoId: 7, reembolso: 'en_revision' }));
  });

  it('si Mercado Pago falla y además no responde la consulta: también queda en revisión, sin lanzar', async () => {
    const { servicio, pago, mercadoPago } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' });
    mercadoPago.reembolsarPago.mockRejectedValueOnce(new Error('timeout'));
    mercadoPago.obtenerPago.mockRejectedValueOnce(new Error('timeout'));

    await expect(cancelar(servicio)).resolves.toMatchObject({ reembolso: { estado: 'en_revision' } });
    expect(pago.estado).toBe('en_revision');
  });

  it('si el reembolso falla pero Mercado Pago dice que ya está reembolsado: cuenta como reembolsado', async () => {
    const { servicio, pago, eventos, mercadoPago } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' });
    mercadoPago.reembolsarPago.mockRejectedValueOnce(new ServiceUnavailableException());
    mercadoPago.obtenerPago.mockResolvedValueOnce({ id: 987654, status: 'refunded' });

    const r = await cancelar(servicio);

    expect(pago.estado).toBe('reembolsado');
    expect(r).toMatchObject({ reembolso: { estado: 'reembolsado', monto: 350 } });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', expect.objectContaining({ reembolso: 'reembolsado' }));
  });

  it('sin pago aprobado de Mercado Pago que reembolsar: no se llama a Mercado Pago y queda en revisión', async () => {
    const { servicio, actual, eventos, mercadoPago } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' }, { conPago: false });

    const r = await cancelar(servicio);

    expect(actual.estado).toBe('cancelado');
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reembolso: { estado: 'en_revision', monto: 350 } });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', expect.objectContaining({ reembolso: 'en_revision' }));
  });
});

describe('Cancelaciones que no tocan Mercado Pago', () => {
  it.each(['mercado_pago', 'pago_en_salon'])('pendiente_pago (%s): sin reembolso, sin aviso al personal, respuesta igual que antes', async (metodoPago) => {
    const { servicio, actual, eventos, mercadoPago, prisma } = montar({ estado: EstadoPedido.pendiente_pago, metodoPago });

    const r = await cancelar(servicio);

    expect(actual.estado).toBe('cancelado');
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(mercadoPago.obtenerPago).not.toHaveBeenCalled();
    expect(prisma.pago.updateMany).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty('reembolso');
    expect(Object.keys(r)).toEqual(['success', 'data']);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado', { pedidoId: 7, usuarioId: CLIENTA });
    expect(eventos.emit).not.toHaveBeenCalledWith('pedido.cancelado_pagado', expect.anything());
  });

  it('pagado con pago en el salón: sin llamar a Mercado Pago, reembolso en revisión y aviso al personal', async () => {
    const { servicio, eventos, mercadoPago, prisma } = montar({ estado: EstadoPedido.pagado, metodoPago: 'pago_en_salon' });

    const r = await cancelar(servicio);

    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(mercadoPago.obtenerPago).not.toHaveBeenCalled();
    expect(prisma.pago.updateMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reembolso: { estado: 'en_revision', monto: 350 } });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', expect.objectContaining({ reembolso: 'en_revision' }));
  });

  it('si la cancelación pierde la carrera (409), no se reembolsa nada', async () => {
    const { servicio, actual, mercadoPago, prisma, eventos } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' });
    // El personal lo pasa a preparación justo después de que se leyó el pedido.
    prisma.pedido.findUnique.mockImplementationOnce(async () => {
      const leido = { ...actual };
      actual.estado = EstadoPedido.preparando;
      return leido;
    });

    await expect(cancelar(servicio)).rejects.toMatchObject({ status: 409 });
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(eventos.emit).not.toHaveBeenCalled();
  });
});

describe('Cancelar un pedido pagado que tiene devoluciones', () => {
  it.each(['aprobada', 'pendiente'])('con una devolución %s: 409, sin reembolso por Mercado Pago y el pedido sigue pagado', async (estado) => {
    const { servicio, actual, pago, mercadoPago, eventos, tx } = montar(
      { estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' },
      { devoluciones: [{ id: 4, pedidoId: 7, estado }] },
    );

    await expect(cancelar(servicio)).rejects.toBeInstanceOf(ConflictException);
    await expect(cancelar(servicio)).rejects.toThrow('Este pedido tiene una devolución en proceso: para cancelarlo comunícate con el salón.');
    // Mismo candado que crear o aprobar devoluciones, para que no se crucen.
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(actual.estado).toBe('pagado');
    expect(pago.estado).toBe('aprobado');
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it.each(['rechazada', 'cancelada'])('una devolución %s no bloquea: se reembolsa como antes', async (estado) => {
    const { servicio, actual, mercadoPago } = montar(
      { estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' },
      { devoluciones: [{ id: 4, pedidoId: 7, estado }] },
    );

    const r = await cancelar(servicio);

    expect(actual.estado).toBe('cancelado');
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(r).toMatchObject({ reembolso: { estado: 'reembolsado', monto: 350 } });
  });

  it('sin devoluciones: se toma el candado y se reembolsa como antes', async () => {
    const { servicio, mercadoPago, tx } = montar({ estado: EstadoPedido.pagado, metodoPago: 'mercado_pago' });

    await expect(cancelar(servicio)).resolves.toMatchObject({ reembolso: { estado: 'reembolsado' } });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledTimes(1);
  });
});
