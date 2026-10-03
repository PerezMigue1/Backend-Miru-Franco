import { NotificacionesListener } from './notificaciones.listener';

describe('Aviso al admin de un pago en revisión', () => {
  function montar() {
    const encolar = jest.fn(async (_tx: unknown, dato: { usuarioId: string }) => ({ notificacionId: 'n', envios: [{ id: `e-${dato.usuarioId}` }] }));
    const resolverUsuariosPorPermiso = jest.fn(async () => ['admin-1', 'admin-2']);
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

  it('pago de un pedido cancelado: un aviso por la app a cada admin, con el texto de revisión', async () => {
    const { listener, encolar, resolverUsuariosPorPermiso, drenarInmediatas } = montar();

    await listener.onPagoRequiereRevision({ pedidoId: 42, referencia: '777', motivo: 'pedido_no_pendiente', estadoPedido: 'cancelado' });

    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('*');
    expect(encolar).toHaveBeenCalledTimes(2);
    for (const [, dato] of encolar.mock.calls as unknown as [unknown, Record<string, unknown>][]) {
      expect(dato).toMatchObject({
        tipo: 'pago_revision',
        titulo: 'Pago por revisar',
        mensaje: 'Pago recibido de un pedido cancelado #42: revisar devolución',
        entidadTipo: 'pedido',
        entidadId: '42',
        canales: [{ canal: 'in_app', estado: 'pendiente' }],
      });
    }
    expect(drenarInmediatas).toHaveBeenCalledWith(['e-admin-1', 'e-admin-2']);
  });

  it('monto distinto: el texto lo dice', async () => {
    const { listener, encolar } = montar();
    await listener.onPagoRequiereRevision({ pedidoId: 42, referencia: '777', motivo: 'monto_distinto', estadoPedido: 'pendiente_pago' });
    expect((encolar.mock.calls[0] as unknown as [unknown, { mensaje: string }])[1].mensaje).toBe(
      'Pago con un monto distinto al del pedido #42: revisar devolución',
    );
  });
});
