import { NotificacionesListener } from './notificaciones.listener';
import { establecerTextosSitio } from '../textos-sitio/textos-sitio.util';
import { establecerReglasNegocio } from '../configuracion-sitio/reglas-negocio';

/**
 * Los avisos internos toman título y mensaje del catálogo de Textos del sitio, y los plazos de la regla guardada en el
 * pedido al crearlo (no los de hoy ni números escritos a mano).
 */
function montar(reglasPedido: unknown) {
  const encolar = jest.fn(async () => ({ notificacionId: 'n', envios: [{ id: 'e1' }] }));
  const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' })));
  const prisma = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    pedido: { findUnique: jest.fn(async () => ({ reglas: reglasPedido })) },
  };
  const listener = new NotificacionesListener(prisma as any, { encolar } as any, { resolverCanales } as any, { drenarInmediatas: jest.fn() } as any);
  const encolado = () => (encolar.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
  return { listener, encolado, prisma };
}

afterEach(() => {
  establecerTextosSitio([]);
  establecerReglasNegocio(null);
});

describe('Plazos de los avisos: los de la regla guardada en el pedido', () => {
  it.each([
    ['apartado_sin_preparar', 'no se preparó en 5 días'],
    ['no_recogido', 'no se recogió en 10 días'],
    ['pago_en_linea_vencido', 'no se completó en 48 horas'],
  ])('vencido por %s usa el plazo del pedido aunque la regla de hoy sea otra', async (motivo, frase) => {
    establecerReglasNegocio({ tienda: { diasPrepararApartado: 1, diasCancelarNoRecogido: 2, diaRecordatorioRecoger: 1, plazoPagoLineaHoras: 1 } });
    const { listener, encolado, prisma } = montar({ diasPrepararApartado: 5, diasCancelarNoRecogido: 10, diaRecordatorioRecoger: 4, plazoPagoLineaHoras: 48 });
    await listener.onPedidoVencido({ pedidoId: 9, usuarioId: 'clienta-1', motivo: motivo as any });
    expect(prisma.pedido.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { reglas: true } });
    expect(String(encolado().mensaje)).toContain(frase);
  });

  it('recordatorio de recoger: los días que quedan salen de la regla del pedido (10 - 4 = 6)', async () => {
    const { listener, encolado } = montar({ diasCancelarNoRecogido: 10, diaRecordatorioRecoger: 4 });
    await listener.onPedidoRecordatorioRecoger({ pedidoId: 9, usuarioId: 'clienta-1' });
    expect(encolado().mensaje).toBe('Recuerda pasar por tu pedido #9. Si no lo recoges en 6 días más, se cancelará.');
  });

  it('pedido anterior a guardar reglas (null): los valores de entonces (3, 7 y 24)', async () => {
    const { listener, encolado } = montar(null);
    await listener.onPedidoVencido({ pedidoId: 9, usuarioId: 'clienta-1', motivo: 'apartado_sin_preparar' });
    expect(encolado().mensaje).toContain('no se preparó en 3 días');
  });
});

describe('Plazos de los avisos de citas: los de la regla guardada en la cita', () => {
  it('si el texto usa un plazo del anticipo, se toma el de la cita aunque la regla de hoy sea otra', async () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: 1 } });
    establecerTextosSitio([{ clave: 'avisos.citaCreada.mensaje', valor: 'Tu cita #{cita} de {servicio}: paga el anticipo en {plazoAnticipoHoras} horas.' }]);
    const encolar = jest.fn(async () => ({ notificacionId: 'n', envios: [{ id: 'e1' }] }));
    const cita = { findUnique: jest.fn(async () => ({ reglas: { plazoAnticipoHoras: 6 } })) };
    const listener = new NotificacionesListener(
      { $transaction: async (fn: (tx: unknown) => unknown) => fn({}), cita } as any,
      { encolar } as any,
      { resolverCanales: jest.fn(async () => [{ canal: 'in_app', estado: 'pendiente' }]) } as any,
      { drenarInmediatas: jest.fn() } as any,
    );
    await listener.onCitaCreada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicio: new Date(Date.now() + 3 * 864e5) });
    const datos = (encolar.mock.calls as unknown as [unknown, Record<string, unknown>][]).map(([, d]) => d);
    expect(datos.find((d) => d.tipo === 'cita_creada')?.mensaje).toBe('Tu cita #7 de Corte: paga el anticipo en 6 horas.');
  });
});

describe('Títulos y mensajes del catálogo', () => {
  it('lo que guarda la dueña cambia el aviso, con sus variables', async () => {
    establecerTextosSitio([
      { clave: 'avisos.pedidoListo.titulo', valor: '¡Ya puedes pasar por tu pedido!' },
      { clave: 'avisos.pedidoListo.mensaje', valor: 'El pedido #{pedido} te espera; lo guardamos {diasResguardo} días.' },
    ]);
    const { listener, encolado } = montar({ diasResguardoPagado: 20 });
    await listener.onPedidoListoRecoger({ pedidoId: 4, usuarioId: 'clienta-1' });
    expect(encolado()).toMatchObject({ titulo: '¡Ya puedes pasar por tu pedido!', mensaje: 'El pedido #4 te espera; lo guardamos 20 días.' });
  });

  it('el pedido confirmado ya no usa el guion largo', async () => {
    const { listener, encolado } = montar(null);
    await listener.onPedidoPagado({ pedidoId: 4, usuarioId: 'clienta-1' });
    expect(encolado().mensaje).toBe('Tu pedido #4 fue confirmado: pago recibido');
  });
});
