import { NotificacionesListener } from './notificaciones.listener';

/**
 * Avisos en vivo del sitio (campana, aviso en pantalla y notificación del navegador): cada quien recibe lo suyo.
 * - Clienta: cita confirmada, reprogramada o cancelada (con la pantalla de su cita), reembolsos y respuesta ARCO.
 * - Personal según sus permisos: cita nueva, anticipo pagado, pedido nuevo, reembolso pendiente.
 * - Admin: lo del personal más las solicitudes ARCO nuevas.
 */
function montar(opciones: { porPermiso?: Record<string, string[]>; pedido?: { metodoPago: string | null; estado: string } | null } = {}) {
  const encolar = jest.fn(async (_tx: unknown, dato: { usuarioId: string }) => ({ notificacionId: 'n', envios: [{ id: `e-${dato.usuarioId}` }] }));
  const porPermiso = opciones.porPermiso ?? {};
  const resolverUsuariosPorPermiso = jest.fn(async (clave: string) => porPermiso[clave] ?? []);
  const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' })));
  const drenarInmediatas = jest.fn();
  const tx = { notificacionEnvio: { updateMany: jest.fn(async () => ({ count: 0 })) } };
  const prisma = {
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    pedido: { findUnique: jest.fn(async () => (opciones.pedido === undefined ? null : opciones.pedido)) },
  };
  const listener = new NotificacionesListener(prisma as any, { encolar } as any, { resolverUsuariosPorPermiso, resolverCanales } as any, { drenarInmediatas } as any);
  jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
  const datos = () => (encolar.mock.calls as unknown as [unknown, Record<string, any>][]).map(([, d]) => d);
  const para = (usuarioId: string) => datos().filter((d) => d.usuarioId === usuarioId);
  return { listener, encolar, resolverUsuariosPorPermiso, drenarInmediatas, datos, para, prisma };
}

const MANANA = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

describe('Clienta: avisos de sus citas con la pantalla de la cita', () => {
  it('cita agendada, cancelada y reprogramada abren el detalle de su cita', async () => {
    const { listener, para } = montar();
    await listener.onCitaCreada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicio: MANANA });
    await listener.onCitaCancelada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', motivo: 'x' });
    await listener.onCitaReprogramada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicioNueva: MANANA });
    const inmediatas = para('cli-1').filter((d) => d.tipo !== 'cita_recordatorio');
    expect(inmediatas.map((d) => d.tipo)).toEqual(['cita_creada', 'cita_cancelada', 'cita_reprogramada']);
    for (const d of inmediatas) expect(d.urlAccion).toBe('/cliente/servicios-citas/mis-citas/7');
  });

  it('la especialista abre la gestión de citas', async () => {
    const { listener, para } = montar();
    await listener.onCitaCreada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicio: MANANA });
    await listener.onCitaCancelada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', motivo: 'x' });
    await listener.onCitaReprogramada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicioNueva: MANANA });
    expect(para('esp-1').map((d) => d.urlAccion)).toEqual(['/operacion/gestion-citas', '/operacion/gestion-citas', '/operacion/gestion-citas']);
  });
});

describe('Personal: cita nueva', () => {
  it('avisa a quien tiene citas:escritura (y al admin), sin repetir a la especialista ni a la clienta', async () => {
    const { listener, resolverUsuariosPorPermiso, para, drenarInmediatas } = montar({ porPermiso: { 'citas:escritura': ['admin-1', 'recepcion-1', 'esp-1', 'cli-1'] } });
    await listener.onCitaNuevaPersonal({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicio: MANANA });
    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('citas:escritura');
    for (const id of ['admin-1', 'recepcion-1']) {
      expect(para(id)).toEqual([
        expect.objectContaining({ tipo: 'cita_nueva', titulo: 'Cita nueva', entidadTipo: 'cita', entidadId: '7', urlAccion: '/operacion/gestion-citas' }),
      ]);
      expect(para(id)[0].mensaje).toMatch(/^Nueva cita de Corte para el /);
    }
    expect(para('esp-1')).toEqual([]);
    expect(para('cli-1')).toEqual([]);
    expect(drenarInmediatas).toHaveBeenCalledWith(['e-admin-1', 'e-recepcion-1']);
  });
});

describe('Personal: anticipo pagado', () => {
  it('avisa a quien maneja la caja', async () => {
    const { listener, resolverUsuariosPorPermiso, datos } = montar({ porPermiso: { 'caja:escritura': ['admin-1', 'cajera-1'] } });
    await listener.onAnticipoPagadoPersonal({ citaId: 9, clienteId: 'cli-1' });
    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('caja:escritura');
    expect(datos().map((d) => d.usuarioId)).toEqual(['admin-1', 'cajera-1']);
    for (const d of datos()) {
      expect(d).toMatchObject({
        tipo: 'anticipo_pagado',
        titulo: 'Anticipo pagado',
        mensaje: 'Se recibió el anticipo de la cita #9: quedó confirmada.',
        entidadTipo: 'cita',
        entidadId: '9',
        urlAccion: '/operacion/gestion-citas',
      });
    }
  });
});

describe('Personal: pedido nuevo', () => {
  it('pedido pagado en línea: avisa a quien entrega pedidos para prepararlo', async () => {
    const { listener, resolverUsuariosPorPermiso, datos } = montar({ porPermiso: { 'pedidos:entregar': ['admin-1', 'empleada-1'] } });
    await listener.onPedidoNuevoPagado({ pedidoId: 42, usuarioId: 'cli-1' });
    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('pedidos:entregar');
    expect(datos().map((d) => d.usuarioId)).toEqual(['admin-1', 'empleada-1']);
    for (const d of datos()) {
      expect(d).toMatchObject({
        tipo: 'pedido_nuevo',
        titulo: 'Pedido nuevo',
        mensaje: 'El pedido #42 ya está pagado: prepáralo para recoger en el salón.',
        entidadTipo: 'pedido',
        entidadId: '42',
        urlAccion: '/operacion/pedidos-online',
      });
    }
  });

  it('apartado (se paga al recoger): avisa al crearse', async () => {
    const { listener, datos } = montar({ porPermiso: { 'pedidos:entregar': ['empleada-1'] }, pedido: { metodoPago: 'pago_en_salon', estado: 'pendiente_pago' } });
    await listener.onPedidoNuevoCreado({ pedidoId: 43, usuarioId: 'cli-1' });
    expect(datos()).toEqual([
      expect.objectContaining({ usuarioId: 'empleada-1', tipo: 'pedido_nuevo', mensaje: 'Nuevo apartado #43: se paga al recogerlo en el salón.', urlAccion: '/operacion/pedidos-online' }),
    ]);
  });

  it('pedido en línea aún sin pagar: no avisa al crearse (llega al pagarse)', async () => {
    const { listener, datos } = montar({ porPermiso: { 'pedidos:entregar': ['empleada-1'] }, pedido: { metodoPago: 'mercadopago', estado: 'pendiente_pago' } });
    await listener.onPedidoNuevoCreado({ pedidoId: 44, usuarioId: 'cli-1' });
    expect(datos()).toEqual([]);
  });
});

describe('Personal: reembolso pendiente (pago en revisión de un pedido)', () => {
  it('avisa a quien gestiona reembolsos y a los admin, sin repetir', async () => {
    const { listener, resolverUsuariosPorPermiso, datos } = montar({ porPermiso: { 'reembolsos:gestionar': ['admin-1', 'finanzas-1'], '*': ['admin-1'] } });
    await listener.onPagoRequiereRevision({ pedidoId: 42, referencia: '777', motivo: 'monto_distinto', estadoPedido: 'pendiente_pago' });
    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('reembolsos:gestionar');
    expect(datos().map((d) => d.usuarioId).sort()).toEqual(['admin-1', 'finanzas-1']);
  });
});

describe('Clienta: reembolsos', () => {
  it('canceló un pedido pagado y el reembolso salió: se le avisa con su pedido', async () => {
    const { listener, datos } = montar();
    await listener.onReembolsoCancelacionClienta({ pedidoId: 42, usuarioId: 'cli-1', clienta: 'Ana', monto: 350, reembolso: 'reembolsado' });
    expect(datos()).toEqual([
      expect.objectContaining({
        usuarioId: 'cli-1',
        tipo: 'reembolso',
        titulo: 'Reembolso realizado',
        mensaje: 'Te reembolsamos $350.00 del pedido #42. Puede tardar unos días en verse en tu cuenta.',
        entidadTipo: 'pedido',
        entidadId: '42',
        urlAccion: '/cliente/tienda-online/mis-pedidos/42',
      }),
    ]);
  });

  it('canceló un pedido pagado y el reembolso quedó en revisión: se le dice que está en proceso', async () => {
    const { listener, datos } = montar();
    await listener.onReembolsoCancelacionClienta({ pedidoId: 42, usuarioId: 'cli-1', clienta: 'Ana', monto: 1250.5, reembolso: 'en_revision' });
    expect(datos()[0]).toMatchObject({ titulo: 'Reembolso en proceso', mensaje: 'Estamos procesando el reembolso de $1,250.50 del pedido #42.' });
  });

  it('reembolso hecho por el personal (pedido o anticipo): aviso a la clienta, uno por reembolso', async () => {
    const { listener, datos } = montar();
    await listener.onReembolsoRealizado({ usuarioId: 'cli-1', entidadTipo: 'pedido', entidadId: 42, monto: 200, referencia: 'pago-5' });
    await listener.onReembolsoRealizado({ usuarioId: 'cli-1', entidadTipo: 'cita', entidadId: 7, monto: 150, referencia: 'pago-6' });
    expect(datos()).toEqual([
      expect.objectContaining({ tipo: 'reembolso', mensaje: 'Te reembolsamos $200.00 del pedido #42.', urlAccion: '/cliente/tienda-online/mis-pedidos/42' }),
      expect.objectContaining({ tipo: 'reembolso', mensaje: 'Te reembolsamos $150.00 del anticipo de tu cita #7.', urlAccion: '/cliente/servicios-citas/mis-citas/7' }),
    ]);
    expect(datos()[0].canales).toEqual([{ canal: 'in_app', estado: 'pendiente', discriminador: 'pago-5' }]);
  });

  it('sin cuenta de clienta no avisa a nadie', async () => {
    const { listener, datos } = montar();
    await listener.onReembolsoRealizado({ usuarioId: null, entidadTipo: 'cita', entidadId: 7, monto: 150, referencia: 'pago-6' });
    expect(datos()).toEqual([]);
  });
});

describe('ARCO', () => {
  it('solicitud nueva: aviso solo a los admin', async () => {
    const { listener, resolverUsuariosPorPermiso, datos } = montar({ porPermiso: { '*': ['admin-1', 'admin-2'] } });
    await listener.onArcoSolicitudCreada({ solicitudId: 3, folio: 'ARCO-0003', tipo: 'acceso' });
    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('*');
    expect(datos().map((d) => d.usuarioId)).toEqual(['admin-1', 'admin-2']);
    expect(datos()[0]).toMatchObject({
      tipo: 'arco_solicitud',
      titulo: 'Solicitud ARCO nueva',
      mensaje: 'Nueva solicitud de acceso con folio ARCO-0003.',
      entidadTipo: 'solicitud_arco',
      entidadId: '3',
      urlAccion: '/admin/solicitudes-arco',
    });
  });

  it('respuesta: aviso a la titular sin el texto de la respuesta, con su sección de solicitudes', async () => {
    const { listener, datos } = montar();
    await listener.onArcoRespondida({ solicitudId: 3, usuarioId: 'cli-1', folio: 'ARCO-0003', estado: 'respondida' });
    expect(datos()).toEqual([
      expect.objectContaining({
        usuarioId: 'cli-1',
        tipo: 'arco_respuesta',
        titulo: 'Respuesta a tu solicitud ARCO',
        mensaje: 'Tu solicitud con folio ARCO-0003 ya tiene respuesta.',
        urlAccion: '/cliente/mi-perfil#privacidad-solicitudes',
      }),
    ]);
    expect(datos()[0].canales).toEqual([{ canal: 'in_app', estado: 'pendiente', discriminador: 'respondida' }]);
  });
});
