import { NotificacionesListener } from './notificaciones.listener';

/**
 * Con la latencia a Neon, encolar en el outbox (notificación + envíos) puede pasar de los 5 s que Prisma da por
 * defecto a una transacción interactiva: "Transaction already closed ... 5752 ms passed". La operación principal
 * (cita, pedido, venta) ya se hizo y el aviso se perdía. Todas las transacciones del listener usan un tiempo
 * holgado (15 s, como TX_HOLGADA).
 */
const LATENCIA_NEON_MS = 5752;

function montar() {
  const opcionesTx: unknown[] = [];
  const tx = { notificacionEnvio: { updateMany: jest.fn(async () => ({ count: 0 })) } };
  const prisma = {
    // Simula la base lenta: una transacción con menos tiempo que lo que tarda se cierra antes de terminar.
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>, opciones?: { timeout?: number }) => {
      opcionesTx.push(opciones);
      if ((opciones?.timeout ?? 5000) < LATENCIA_NEON_MS) {
        throw new Error(`Transaction already closed: The timeout for this transaction was ${opciones?.timeout ?? 5000} ms, however ${LATENCIA_NEON_MS} ms passed`);
      }
      return fn(tx);
    }),
  };
  const encolar = jest.fn(async (_tx: unknown, dato: { usuarioId: string }) => ({ notificacionId: 'n', envios: [{ id: `e-${dato.usuarioId}` }] }));
  const resolver = {
    resolverUsuariosPorPermiso: jest.fn(async () => ['admin-1']),
    resolverCanales: jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' }))),
  };
  const drenarInmediatas = jest.fn();
  const listener = new NotificacionesListener(prisma as any, { encolar } as any, resolver as any, { drenarInmediatas } as any);
  jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
  return { listener, prisma, opcionesTx, encolar, drenarInmediatas };
}

const MANANA = new Date(Date.now() + 2 * 24 * 60 * 60_000);

const avisos: [string, (l: NotificacionesListener) => Promise<void>][] = [
  ['cita.creada', (l) => l.onCitaCreada({ citaId: 1, clienteId: 'cli-1', especialistaId: 'est-1', servicioNombre: 'Corte', fechaHoraInicio: MANANA })],
  ['cita.cancelada', (l) => l.onCitaCancelada({ citaId: 1, clienteId: 'cli-1', especialistaId: 'est-1', motivo: 'Ya no puedo' })],
  ['cita.reprogramada', (l) => l.onCitaReprogramada({ citaId: 1, clienteId: 'cli-1', especialistaId: 'est-1', servicioNombre: 'Corte', fechaHoraInicioNueva: MANANA })],
  ['venta_local.pagada', (l) => l.onVentaLocalPagada({ ventaId: 1, clienteId: 'cli-1', folio: 'VL-2026-000001', total: 100, creadoEn: new Date() })],
  ['pago.requiere_revision (pedido)', (l) => l.onPagoRequiereRevision({ pedidoId: 7, referencia: '555', motivo: 'monto_distinto' })],
  ['pago.requiere_revision (anticipo)', (l) => l.onPagoRequiereRevision({ citaId: 3, referencia: '556', motivo: 'cita_no_vigente' })],
  ['pedido.cancelado_pagado', (l) => l.onPedidoCanceladoPagado({ pedidoId: 7, usuarioId: 'cli-1', clienta: 'Ana', monto: 350, reembolso: 'en_revision' })],
  ['cita.anticipo_pagado', (l) => l.onAnticipoPagado({ citaId: 3, clienteId: 'cli-1' })],
  ['pedido.creado', (l) => l.onPedidoCreado({ pedidoId: 7, usuarioId: 'cli-1' })],
  ['pedido.revocacion_por_recibir', (l) => l.onRevocacionPorRecibir({ pedidoId: 7, usuarioId: 'cli-1', devolucionId: 100, monto: 350 })],
  ['cita.anticipo_por_devolver', (l) => l.onAnticipoPorDevolver({ citaId: 3, motivo: 'pagado_en_salon' })],
];

describe('Avisos del outbox con la latencia de Neon: la transacción usa un tiempo holgado', () => {
  it.each(avisos)('%s: encola el aviso aunque la transacción tarde más de 5 s', async (_evento, avisar) => {
    const { listener, opcionesTx, encolar, drenarInmediatas } = montar();

    await expect(avisar(listener)).resolves.toBeUndefined();

    expect(opcionesTx.length).toBeGreaterThan(0);
    for (const opciones of opcionesTx) expect(opciones).toMatchObject({ timeout: 15_000 });
    expect(encolar).toHaveBeenCalled();
    expect(drenarInmediatas).toHaveBeenCalled();
  });
});
