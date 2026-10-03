import { NotificacionesListener } from './notificaciones.listener';

function montar() {
  const encolar = jest.fn(async () => ({ notificacionId: 'n', envios: [{ id: 'e1' }, { id: 'e2' }] }));
  const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' })));
  const drenarInmediatas = jest.fn();
  const listener = new NotificacionesListener(
    { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as any,
    { encolar } as any,
    { resolverCanales } as any,
    { drenarInmediatas } as any,
  );
  const encolado = () => (encolar.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
  return { listener, encolar, resolverCanales, drenarInmediatas, encolado };
}

describe('Avisos a la clienta de apartados y pedidos en línea vencidos', () => {
  it.each([
    ['apartado_sin_preparar', 'Tu apartado #9 se canceló porque no se preparó en 3 días. Puedes volver a pedirlo en la tienda.'],
    ['no_recogido', 'Cancelamos tu apartado #9 porque no se recogió en 7 días.'],
    ['pago_en_linea_vencido', 'Tu pedido #9 se canceló porque el pago no se completó en 24 horas.'],
  ])('vencido por %s: aviso por la app y por correo', async (motivo, mensaje) => {
    const { listener, resolverCanales, encolado } = montar();
    await listener.onPedidoVencido({ pedidoId: 9, usuarioId: 'clienta-1', motivo: motivo as any });
    expect(resolverCanales).toHaveBeenCalledWith('clienta-1', 'pedido_cancelado', ['in_app', 'email']);
    expect(encolado()).toMatchObject({ usuarioId: 'clienta-1', tipo: 'pedido_cancelado', titulo: 'Pedido cancelado', mensaje, entidadTipo: 'pedido', entidadId: '9' });
  });

  it('recordatorio de recoger: por la app y por correo, con su propio tipo', async () => {
    const { listener, resolverCanales, encolado, drenarInmediatas } = montar();
    await listener.onPedidoRecordatorioRecoger({ pedidoId: 9, usuarioId: 'clienta-1' });
    expect(resolverCanales).toHaveBeenCalledWith('clienta-1', 'pedido_recordatorio_recoger', ['in_app', 'email']);
    expect(encolado()).toMatchObject({
      tipo: 'pedido_recordatorio_recoger',
      titulo: 'Tu pedido te espera en el salón',
      mensaje: 'Recuerda pasar por tu pedido #9. Si no lo recoges en 4 días más, se cancelará.',
    });
    expect(drenarInmediatas).toHaveBeenCalledWith(['e1', 'e2']);
  });
});
