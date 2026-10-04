import { NotificacionesListener } from './notificaciones.listener';

/**
 * Una cita sin cita (walk-in) puede no tener clienta registrada: no hay a quién notificar del lado de la
 * clienta, pero la especialista sí debe recibir su aviso (antes toda la transacción se revertía).
 */
function montar() {
  const encolar = jest.fn(async () => ({ notificacionId: 'n', envios: [{ id: 'e1' }] }));
  const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' })));
  const tx = { notificacionEnvio: { updateMany: jest.fn(async () => ({ count: 0 })) } };
  const listener = new NotificacionesListener(
    { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as any,
    { encolar } as any,
    { resolverCanales } as any,
    { drenarInmediatas: jest.fn() } as any,
  );
  const destinatarios = () => encolar.mock.calls.map((c: any[]) => c[1].usuarioId);
  return { listener, encolar, resolverCanales, destinatarios };
}

const MANANA = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

describe('Avisos de citas sin clienta registrada (sin cita)', () => {
  it('cita creada: solo avisa a la especialista, sin recordatorios para nadie', async () => {
    const { listener, destinatarios, resolverCanales } = montar();
    await listener.onCitaCreada({ citaId: 7, clienteId: null, especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicio: MANANA });
    expect(destinatarios()).toEqual(['esp-1']);
    expect(resolverCanales.mock.calls.every((c: any[]) => c[0] === 'esp-1')).toBe(true);
  });

  it('cita cancelada: solo avisa a la especialista', async () => {
    const { listener, destinatarios } = montar();
    await listener.onCitaCancelada({ citaId: 7, clienteId: null, especialistaId: 'esp-1', motivo: 'Se fue' });
    expect(destinatarios()).toEqual(['esp-1']);
  });

  it('cita reprogramada: solo avisa a la especialista', async () => {
    const { listener, destinatarios } = montar();
    await listener.onCitaReprogramada({ citaId: 7, clienteId: null, especialistaId: 'esp-1', servicioNombre: 'Corte', fechaHoraInicioNueva: MANANA });
    expect(destinatarios()).toEqual(['esp-1']);
  });

  it('con clienta registrada sigue avisando a las dos', async () => {
    const { listener, destinatarios } = montar();
    await listener.onCitaCancelada({ citaId: 7, clienteId: 'cli-1', especialistaId: 'esp-1', motivo: 'x' });
    expect(destinatarios()).toEqual(['cli-1', 'esp-1']);
  });
});
