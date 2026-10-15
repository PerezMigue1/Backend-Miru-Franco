import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { EVENTO_ANTICIPO_POR_DEVOLVER } from '../citas/anticipos/anticipos.util';
import { PrismaService } from '../prisma/prisma.service';
import { DespachadorService } from './despachador.service';
import { NotificacionesListener } from './notificaciones.listener';
import { OutboxService } from './outbox.service';
import { ResolverDestinatariosService } from './resolver-destinatarios.service';

/**
 * Avisos al personal de dinero o producto que hay que devolver:
 * - la clienta revocó la compra de un pedido que ya tiene (entregado o el heredado enviado): quien gestiona
 *   devoluciones debe recibir el producto en el salón y reembolsar;
 * - la clienta canceló a tiempo una cita con anticipo y no se reembolsó solo (pagado en el salón, o falló el
 *   reembolso automático): quien maneja la caja debe devolverlo.
 * Por la app (in_app), con el outbox y el tiempo holgado de los demás avisos, un envío por destinatario.
 */
function montar() {
  const opcionesTx: unknown[] = [];
  const encolar = jest.fn(async (_tx: unknown, dato: { usuarioId: string }) => ({ notificacionId: 'n', envios: [{ id: `e-${dato.usuarioId}` }] }));
  const resolverUsuariosPorPermiso = jest.fn(async () => ['admin-1', 'estilista-1']);
  const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) => canales.map((canal) => ({ canal, estado: 'pendiente' })));
  const drenarInmediatas = jest.fn();
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown, opciones?: unknown) => {
      opcionesTx.push(opciones);
      return fn({});
    }),
  };
  const listener = new NotificacionesListener(prisma as any, { encolar } as any, { resolverUsuariosPorPermiso, resolverCanales } as any, { drenarInmediatas } as any);
  jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
  const datos = () => (encolar.mock.calls as unknown as [unknown, Record<string, any>][]).map(([, d]) => d);
  return { listener, encolar, resolverUsuariosPorPermiso, drenarInmediatas, opcionesTx, datos };
}

describe('Revocación por recibir: aviso a quien gestiona devoluciones', () => {
  it('un aviso por la app a cada persona con devoluciones:gestionar, con el pedido y la pantalla de devoluciones', async () => {
    const { listener, resolverUsuariosPorPermiso, drenarInmediatas, opcionesTx, datos } = montar();

    await listener.onRevocacionPorRecibir({ pedidoId: 42, usuarioId: 'clienta-1', devolucionId: 100, monto: 350 });

    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('devoluciones:gestionar');
    expect(datos()).toHaveLength(2);
    for (const dato of datos()) {
      expect(dato).toMatchObject({
        tipo: 'revocacion_por_recibir',
        titulo: 'Revocación por recibir',
        mensaje: 'La clienta revocó la compra del pedido #42: recibe el producto en el salón y reembolsa.',
        entidadTipo: 'pedido',
        entidadId: '42',
        urlAccion: '/operacion/devoluciones',
        metadata: { devolucionId: 100, monto: 350 },
      });
      // Un envío por destinatario (la clave de idempotencia lleva su id).
      expect(dato.canales).toEqual([{ canal: 'in_app', estado: 'pendiente', discriminador: dato.usuarioId }]);
    }
    expect(opcionesTx).toEqual([{ timeout: 15_000 }]);
    expect(drenarInmediatas).toHaveBeenCalledWith(['e-admin-1', 'e-estilista-1']);
  });

  it('un fallo al encolar nunca se propaga (la revocación ya quedó registrada)', async () => {
    const { listener, encolar, drenarInmediatas } = montar();
    encolar.mockRejectedValueOnce(new Error('db caída'));
    await expect(listener.onRevocacionPorRecibir({ pedidoId: 42, usuarioId: 'clienta-1', devolucionId: 100, monto: 350 })).resolves.toBeUndefined();
    expect(drenarInmediatas).not.toHaveBeenCalled();
  });
});

describe('Anticipo por devolver: aviso a quien maneja la caja', () => {
  it.each([
    ['pagado_en_salon', 'La clienta canceló a tiempo la cita #7: devuélvele el anticipo que pagó en el salón.'],
    ['reembolso_automatico_fallo', 'La clienta canceló a tiempo la cita #7 y el reembolso automático del anticipo no salió: reembólsalo a mano.'],
  ] as const)('%s: un aviso por la app a cada persona con caja:escritura, con la cita y Gestión de citas', async (motivo, mensaje) => {
    const { listener, resolverUsuariosPorPermiso, drenarInmediatas, opcionesTx, datos } = montar();

    await listener.onAnticipoPorDevolver({ citaId: 7, motivo });

    expect(resolverUsuariosPorPermiso).toHaveBeenCalledWith('caja:escritura');
    expect(datos()).toHaveLength(2);
    for (const dato of datos()) {
      expect(dato).toMatchObject({
        tipo: 'anticipo_por_devolver',
        titulo: 'Anticipo por devolver',
        mensaje,
        entidadTipo: 'cita',
        entidadId: '7',
        urlAccion: '/operacion/gestion-citas',
        metadata: { motivo },
      });
      expect(dato.canales).toEqual([{ canal: 'in_app', estado: 'pendiente', discriminador: dato.usuarioId }]);
    }
    expect(opcionesTx).toEqual([{ timeout: 15_000 }]);
    expect(drenarInmediatas).toHaveBeenCalledWith(['e-admin-1', 'e-estilista-1']);
  });

  it('un fallo al encolar nunca se propaga (la cita ya quedó cancelada)', async () => {
    const { listener, encolar } = montar();
    encolar.mockRejectedValueOnce(new Error('db caída'));
    await expect(listener.onAnticipoPorDevolver({ citaId: 7, motivo: 'pagado_en_salon' })).resolves.toBeUndefined();
  });
});

describe('Los eventos que emiten los servicios llegan al listener (contenedor real de Nest)', () => {
  it('pedido.revocacion_por_recibir (PedidosService.revocar) y cita.anticipo_por_devolver (AnticiposCitasService) se entregan', async () => {
    const encolar = jest.fn(async () => ({ notificacionId: 'n', envios: [] }));
    const modulo = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        NotificacionesListener,
        { provide: PrismaService, useValue: { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } },
        { provide: OutboxService, useValue: { encolar } },
        { provide: ResolverDestinatariosService, useValue: { resolverUsuariosPorPermiso: async () => ['admin-1'], resolverCanales: async () => [{ canal: 'in_app', estado: 'pendiente' }] } },
        { provide: DespachadorService, useValue: { drenarInmediatas: jest.fn() } },
      ],
    }).compile();
    await modulo.init();
    try {
      const eventos = modulo.get(EventEmitter2);
      await eventos.emitAsync('pedido.revocacion_por_recibir', { pedidoId: 42, usuarioId: 'clienta-1', devolucionId: 100, monto: 350 });
      await eventos.emitAsync(EVENTO_ANTICIPO_POR_DEVOLVER, { citaId: 7, motivo: 'pagado_en_salon' });
      expect(encolar.mock.calls.map((c: unknown[]) => (c[1] as { tipo: string }).tipo)).toEqual(['revocacion_por_recibir', 'anticipo_por_devolver']);
    } finally {
      await modulo.close();
    }
  });
});
