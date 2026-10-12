import { NotificacionesListener } from './notificaciones.listener';

describe('Aviso al personal cuando la clienta cancela un pedido pagado', () => {
  function montar() {
    const encolar = jest.fn(async (_tx: unknown, dato: { usuarioId: string }) => ({ notificacionId: 'n', envios: [{ id: `e-${dato.usuarioId}` }] }));
    const resolverUsuariosPorPermiso = jest.fn(async () => ['admin-1', 'cajera-1']);
    const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' })));
    const drenarInmediatas = jest.fn();
    const listener = new NotificacionesListener(
      { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as any,
      { encolar } as any,
      { resolverUsuariosPorPermiso, resolverCanales } as any,
      { drenarInmediatas } as any,
    );
    return { listener, encolar, resolverUsuariosPorPermiso, drenarInmediatas };
  }

  it('reembolso hecho: un aviso por la app a quien maneja la caja, con pedido, clienta y monto', async () => {
    const { listener, encolar, resolverUsuariosPorPermiso, drenarInmediatas } = montar();

    await listener.onPedidoCanceladoPagado({ pedidoId: 42, usuarioId: 'clienta-1', clienta: 'Ana López', monto: 350, reembolso: 'reembolsado' });

    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('caja:escritura');
    expect(encolar).toHaveBeenCalledTimes(2);
    for (const [, dato] of encolar.mock.calls as unknown as [unknown, Record<string, any>][]) {
      expect(dato).toMatchObject({
        tipo: 'pedido_cancelado_pagado',
        titulo: 'Pedido pagado cancelado',
        mensaje: 'Ana López canceló el pedido #42 ya pagado ($350.00): el reembolso en Mercado Pago ya salió',
        entidadTipo: 'pedido',
        entidadId: '42',
      });
      // Un envío por destinatario (la clave de idempotencia lleva su id).
      expect(dato.canales).toEqual([{ canal: 'in_app', estado: 'pendiente', discriminador: dato.usuarioId }]);
    }
    expect(drenarInmediatas).toHaveBeenCalledWith(['e-admin-1', 'e-cajera-1']);
  });

  it('reembolso en revisión: el texto pide reembolsar a mano', async () => {
    const { listener, encolar } = montar();
    await listener.onPedidoCanceladoPagado({ pedidoId: 42, usuarioId: 'clienta-1', clienta: 'Ana López', monto: 1250.5, reembolso: 'en_revision' });
    const dato = (encolar.mock.calls[0] as unknown as [unknown, { titulo: string; mensaje: string }])[1];
    expect(dato.titulo).toBe('Reembolso por revisar');
    expect(dato.mensaje).toBe('Ana López canceló el pedido #42 ya pagado ($1,250.50): el reembolso quedó en revisión, reembolsar a mano');
  });

  it('un fallo al encolar nunca se propaga (no afecta el pedido)', async () => {
    const { listener, encolar, drenarInmediatas } = montar();
    encolar.mockRejectedValueOnce(new Error('db caída'));
    jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await expect(
      listener.onPedidoCanceladoPagado({ pedidoId: 42, usuarioId: 'clienta-1', clienta: 'Ana', monto: 350, reembolso: 'en_revision' }),
    ).resolves.toBeUndefined();
    expect(drenarInmediatas).not.toHaveBeenCalled();
  });
});
