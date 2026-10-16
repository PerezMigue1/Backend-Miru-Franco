import { Logger } from '@nestjs/common';
import { INTERVALO_VERIFICACION_MS, MINUTOS_MINIMOS_PENDIENTE, VerificacionPagosService } from './verificacion-pagos.service';

/**
 * Verificación activa periódica: cada 10 minutos consulta en Mercado Pago los pagos en línea pendientes con más de
 * 5 minutos (pedidos y anticipos de citas) y aplica los aprobados con la misma lógica idempotente del webhook. Así
 * se rescata un pago cuyo aviso no llegó (por ejemplo, porque la notification_url apuntaba a otro entorno).
 */
const AHORA = new Date('2026-10-15T14:00:00.000Z');
const ENV = { ...process.env };

function montar(opciones: { pedidos?: { id: number }[]; citas?: { id: number }[] } = {}) {
  const prisma = {
    pedido: { findMany: jest.fn(async () => opciones.pedidos ?? []) },
    cita: { findMany: jest.fn(async () => opciones.citas ?? []) },
  };
  const pagos = { verificarPedidoPendiente: jest.fn(async (_id: number) => 'pagado' as string | null) };
  const anticipos = { aplicarPagoAprobadoDeMp: jest.fn(async (_id: number) => 'pagado' as string | null) };
  const servicio = new VerificacionPagosService(prisma as any, pagos as any, anticipos as any);
  return { servicio, prisma, pagos, anticipos };
}

describe('Verificación periódica de pagos pendientes', () => {
  beforeEach(() => {
    process.env = { ...ENV, MP_ACCESS_TOKEN: 'token-de-prueba-ficticio' };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...ENV };
    jest.restoreAllMocks();
  });

  it('corre cada 10 minutos y solo toma pendientes con más de 5 minutos', () => {
    expect(INTERVALO_VERIFICACION_MS).toBe(10 * 60_000);
    expect(MINUTOS_MINIMOS_PENDIENTE).toBe(5);
  });

  it('pedidos: solo pendientes de pago con Mercado Pago, creados hace más de 5 minutos y aún vigentes', async () => {
    const { servicio, prisma } = montar();
    await servicio.verificar(AHORA);
    const where = (prisma.pedido.findMany.mock.calls[0] as any)[0].where;
    expect(where).toMatchObject({ estado: 'pendiente_pago', metodoPago: 'mercado_pago' });
    expect(where.creadoEn.lte.toISOString()).toBe('2026-10-15T13:55:00.000Z');
    // El plazo más largo que permite el panel (72 h; cada pedido guarda el suyo) más una hora de margen.
    expect(where.creadoEn.gte.toISOString()).toBe('2026-10-12T13:00:00.000Z');
  });

  it('citas: anticipo sin pagar (también la que cambió a pago en el salón después de abrir Mercado Pago), cita vigente, creada entre hace 73 h y hace 5 minutos', async () => {
    delete process.env.ANTICIPOS_DESDE;
    const { servicio, prisma } = montar();
    await servicio.verificar(AHORA);
    const where = (prisma.cita.findMany.mock.calls[0] as any)[0].where;
    expect(where).toMatchObject({ anticipoRequerido: { gt: 0 }, anticipoPagadoEn: null });
    expect(where).not.toHaveProperty('anticipoEnSalon');
    expect(where.estado.in).toEqual(['pendiente', 'confirmada', 'reprogramada']);
    expect(where.creadoEn.lte.toISOString()).toBe('2026-10-15T13:55:00.000Z');
    // El plazo en línea más largo que permite el panel (72 h) más una de margen acota la consulta.
    expect(where.creadoEn.gte.toISOString()).toBe('2026-10-12T13:00:00.000Z');
  });

  it('citas: nunca antes de que empezaran los anticipos (ANTICIPOS_DESDE)', async () => {
    process.env.ANTICIPOS_DESDE = '2026-10-15T09:00:00.000Z';
    const { servicio, prisma } = montar();
    await servicio.verificar(AHORA);
    const where = (prisma.cita.findMany.mock.calls[0] as any)[0].where;
    expect(where.creadoEn.gte.toISOString()).toBe('2026-10-15T09:00:00.000Z');
  });

  it('webhook que no llegó: el pago aprobado del pedido y el del anticipo se aplican aquí', async () => {
    const { servicio, pagos, anticipos } = montar({ pedidos: [{ id: 3101 }], citas: [{ id: 25 }] });
    await expect(servicio.verificar(AHORA)).resolves.toEqual({ pedidos: [3101], citas: [25] });
    expect(pagos.verificarPedidoPendiente).toHaveBeenCalledWith(3101);
    expect(anticipos.aplicarPagoAprobadoDeMp).toHaveBeenCalledWith(25);
  });

  it('sin pago aprobado (pendiente o rechazado) no se reporta nada', async () => {
    const { servicio, pagos, anticipos } = montar({ pedidos: [{ id: 1 }], citas: [{ id: 2 }] });
    pagos.verificarPedidoPendiente.mockResolvedValue(null);
    anticipos.aplicarPagoAprobadoDeMp.mockResolvedValue(null);
    await expect(servicio.verificar(AHORA)).resolves.toEqual({ pedidos: [], citas: [] });
  });

  it('si Mercado Pago falla con uno, sigue con los demás y lo registra', async () => {
    const { servicio, pagos } = montar({ pedidos: [{ id: 1 }, { id: 2 }] });
    pagos.verificarPedidoPendiente.mockRejectedValueOnce(new Error('Mercado Pago respondió 500'));
    await expect(servicio.verificar(AHORA)).resolves.toEqual({ pedidos: [2], citas: [] });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('sin MP_ACCESS_TOKEN no consulta nada', async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const { servicio, prisma } = montar({ pedidos: [{ id: 1 }] });
    await expect(servicio.verificar(AHORA)).resolves.toEqual({ pedidos: [], citas: [] });
    expect(prisma.pedido.findMany).not.toHaveBeenCalled();
  });

  it('dos pasadas a la vez: la segunda no corre (no se pisa con la anterior)', async () => {
    const { servicio, pagos } = montar({ pedidos: [{ id: 1 }] });
    let soltar!: () => void;
    pagos.verificarPedidoPendiente.mockImplementationOnce(() => new Promise((r) => (soltar = () => r('pagado'))));
    const primera = servicio.alIntervalo();
    await servicio.alIntervalo();
    expect(pagos.verificarPedidoPendiente).toHaveBeenCalledTimes(1);
    soltar();
    await primera;
  });
});

describe('Cableado de la verificación periódica', () => {
  it('al arrancar avisa en el log si MP_ENTORNO no está definido (el entorno se dedujo de NODE_ENV)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delete process.env.MP_ENTORNO;
    montar().servicio.onModuleInit();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/MP_ENTORNO/));
    warn.mockClear();
    process.env.MP_ENTORNO = 'dev';
    montar().servicio.onModuleInit();
    expect(warn).not.toHaveBeenCalled();
  });

  it('EcommerceModule registra VerificacionPagosService (si no, el @Interval nunca corre)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EcommerceModule } = require('../ecommerce.module');
    expect(Reflect.getMetadata('providers', EcommerceModule)).toContain(VerificacionPagosService);
  });
});
