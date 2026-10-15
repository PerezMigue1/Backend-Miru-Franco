import { EstadoPedido } from '@prisma/client';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { PagosEnLineaService } from './pagos-en-linea.service';
import type { PagoMercadoPago } from './mercadopago.client';

/**
 * Separación de entornos en los pagos con Mercado Pago (simulado): la preferencia lleva "<entorno>-<id>", el aviso
 * con el prefijo de otro entorno se rechaza con registro en el log, las referencias antiguas sin prefijo siguen
 * valiendo y la verificación activa busca primero la nueva y luego la antigua.
 */
const CLIENTA = 'clienta-1';
const CREADO = new Date('2026-10-15T13:39:57.000Z');
const ENV_ORIGINAL = { ...process.env };

function montar(pedidoInicial: Partial<{ estado: EstadoPedido; total: number }> = {}) {
  const pedido = {
    id: 3101,
    usuarioId: CLIENTA,
    estado: EstadoPedido.pendiente_pago as EstadoPedido,
    metodoPago: 'mercado_pago',
    total: 515,
    creadoEn: CREADO,
    pagadoEn: null as Date | null,
    referenciaPago: null as string | null,
    items: [{ presentacionId: 7, cantidad: 1, precioUnitario: 515, nombreProducto: 'Kit', tamanio: null }],
    ...pedidoInicial,
  };
  const pagos: Record<string, unknown>[] = [];
  const candados: string[] = [];
  const orden: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, clave: string) => {
      candados.push(clave);
      orden.push('candado');
      return 1;
    }),
    pedido: {
      updateMany: jest.fn(async ({ where, data }: { where: { id: number; estado: EstadoPedido }; data: Record<string, unknown> }) => {
        orden.push('pedido.updateMany');
        if (where.id !== pedido.id || pedido.estado !== where.estado) return { count: 0 };
        Object.assign(pedido, data);
        return { count: 1 };
      }),
    },
    pago: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        let count = 0;
        for (const fila of data) {
          if (pagos.some((p) => p.proveedor === fila.proveedor && p.referenciaExterna === fila.referenciaExterna)) continue;
          pagos.push(fila);
          count++;
        }
        return { count };
      }),
    },
    historialEstadoPedido: { create: jest.fn(async () => undefined) },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(async () => ({ ...pedido, items: pedido.items.map((i) => ({ ...i })) })) },
    permisoRol: { findUnique: jest.fn(async () => ({ claves: [] })) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = { getRol: jest.fn(async () => 'cliente') };
  const cliente = {
    obtenerPago: jest.fn<Promise<PagoMercadoPago>, [string]>(),
    buscarUltimoPago: jest.fn<Promise<PagoMercadoPago | null>, [string]>(async () => null),
    crearPreferencia: jest.fn(async (_cuerpo: Record<string, unknown>) => ({ id: 'pref-1', init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref-1' })),
  };
  const anticipos = { procesarPagoCita: jest.fn(async () => 'pagado' as const) };
  const eventos = { emit: jest.fn() };
  const servicio = new PagosEnLineaService(prisma as any, access as any, cliente as any, eventos as any, anticipos as any);
  return { servicio, pedido, pagos, candados, orden, cliente, anticipos, eventos };
}

const pagoMp = (cambio: Partial<PagoMercadoPago> = {}): PagoMercadoPago => ({
  id: 184286447230,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 515,
  currency_id: 'MXN',
  external_reference: 'dev-3101',
  date_approved: '2026-10-15T09:44:26.000-04:00',
  date_created: '2026-10-15T09:44:26.000-04:00',
  ...cambio,
});

describe('Separación de entornos: el aviso de pago', () => {
  let aviso: jest.SpyInstance;
  beforeEach(() => {
    process.env = { ...ENV_ORIGINAL, MP_ENTORNO: 'dev' };
    aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    jest.restoreAllMocks();
  });

  it('con el prefijo de su entorno (dev-3101 en desarrollo): marca el pedido pagado', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp());
    expect(await servicio.procesarPago('184286447230')).toBe('pagado');
    expect(pedido.estado).toBe('pagado');
  });

  it('con el prefijo de OTRO entorno (prod-3101 llegando a desarrollo): no escribe nada y lo deja en el log', async () => {
    const { servicio, cliente, pedido, pagos, eventos } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: 'prod-3101' }));
    expect(await servicio.procesarPago('184286447230')).toBe('otro_entorno');
    expect(pedido.estado).toBe('pendiente_pago');
    expect(pagos).toHaveLength(0);
    expect(eventos.emit).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('otro entorno'));
    expect(String(aviso.mock.calls[0][0])).toContain('prod-3101');
  });

  it('producción rechaza un aviso de una prueba local (dev-3089), aunque exista un pedido 3089 en su base', async () => {
    process.env.MP_ENTORNO = 'prod';
    const { servicio, cliente, pedido, pagos } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: 'dev-3101' }));
    expect(await servicio.procesarPago('1')).toBe('otro_entorno');
    expect(pedido.estado).toBe('pendiente_pago');
    expect(pagos).toHaveLength(0);
  });

  it('cita de otro entorno (prod-cita-5 en desarrollo): no llega a los anticipos', async () => {
    const { servicio, cliente, anticipos } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: 'prod-cita-5' }));
    expect(await servicio.procesarPago('1')).toBe('otro_entorno');
    expect(anticipos.procesarPagoCita).not.toHaveBeenCalled();
  });

  it('cita de su entorno o antigua sin prefijo: pasa a los anticipos con el id de la cita', async () => {
    const { servicio, cliente, anticipos } = montar();
    cliente.obtenerPago.mockResolvedValueOnce(pagoMp({ external_reference: 'dev-cita-5' }));
    await servicio.procesarPago('1');
    cliente.obtenerPago.mockResolvedValueOnce(pagoMp({ external_reference: 'cita-6' }));
    await servicio.procesarPago('2');
    expect(anticipos.procesarPagoCita.mock.calls.map((c: unknown[]) => c[1])).toEqual([5, 6]);
  });

  it('referencia antigua sin prefijo (emitida antes del cambio, también desde la app): sigue marcando pagado', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: '3101' }));
    expect(await servicio.procesarPago('184286447230')).toBe('pagado');
    expect(pedido.estado).toBe('pagado');
  });

  it('referencia antigua de un pago creado ANTES que el pedido (el id coincide con el de otra base): se ignora y se registra', async () => {
    const { servicio, cliente, pedido, pagos } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: '3101', date_created: '2026-10-12T08:19:00.000Z' }));
    expect(await servicio.procesarPago('182714058919')).toBe('ignorado');
    expect(pedido.estado).toBe('pendiente_pago');
    expect(pagos).toHaveLength(0);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('anterior al pedido'));
  });

  it('candado por pago: toma pg_advisory_xact_lock con la referencia antes de escribir', async () => {
    const { servicio, cliente, candados, orden } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp());
    await servicio.procesarPago('184286447230');
    expect(candados).toEqual(['mercadopago:184286447230']);
    expect(orden[0]).toBe('candado');
  });

  it('webhook duplicado (el mismo pago dos veces): la segunda no registra nada', async () => {
    const { servicio, cliente, pagos } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp());
    expect(await servicio.procesarPago('184286447230')).toBe('pagado');
    expect(await servicio.procesarPago('184286447230')).toBe('ya_procesado');
    expect(pagos).toHaveLength(1);
  });
});

describe('Separación de entornos: la preferencia y la verificación activa', () => {
  const AHORA = new Date('2026-10-15T13:45:00.000Z');
  beforeEach(() => {
    process.env = { ...ENV_ORIGINAL, MP_ENTORNO: 'dev', FRONTEND_URL: 'https://www.mirufranco.com', MP_WEBHOOK_URL: 'https://api.ejemplo.test/api/pagos-en-linea/mercadopago/webhook' };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    jest.restoreAllMocks();
  });

  it('la preferencia lleva la referencia con prefijo y la notification_url y back_urls de las variables de entorno', async () => {
    const { servicio, cliente } = montar();
    await servicio.crearPreferencia(3101, CLIENTA, AHORA);
    const cuerpo = cliente.crearPreferencia.mock.calls[0][0] as Record<string, any>;
    expect(cuerpo.external_reference).toBe('dev-3101');
    expect(cuerpo.notification_url).toBe('https://api.ejemplo.test/api/pagos-en-linea/mercadopago/webhook');
    expect(cuerpo.back_urls.success).toBe('https://www.mirufranco.com/cliente/tienda-online/confirmacion?pedidoId=3101');
    expect(cuerpo.auto_return).toBe('approved');
  });

  it('sin MP_WEBHOOK_URL no manda notification_url (no hay dominio de respaldo escrito en el código)', async () => {
    delete process.env.MP_WEBHOOK_URL;
    const { servicio, cliente } = montar();
    await servicio.crearPreferencia(3101, CLIENTA, AHORA);
    expect(cliente.crearPreferencia.mock.calls[0][0]).not.toHaveProperty('notification_url');
  });

  it('sin FRONTEND_URL no crea la preferencia (Mercado Pago no tendría a dónde regresar) y lo registra', async () => {
    delete process.env.FRONTEND_URL;
    const { servicio, cliente } = montar();
    await expect(servicio.crearPreferencia(3101, CLIENTA, AHORA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(cliente.crearPreferencia).not.toHaveBeenCalled();
  });

  it('regreso sin webhook: busca dev-3101 y, si no hay, la referencia antigua 3101; el pago aprobado se aplica', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.buscarUltimoPago.mockImplementation(async (ref: string) => (ref === '3101' ? pagoMp({ external_reference: '3101' }) : null));
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: '3101' }));
    const r = await servicio.consultarEstado(3101, CLIENTA);
    expect(cliente.buscarUltimoPago.mock.calls.map((c) => c[0])).toEqual(['dev-3101', '3101']);
    expect(r.estado).toBe('aprobado');
    expect(pedido.estado).toBe('pagado');
  });

  it('regreso con pago pendiente en Mercado Pago: responde pendiente sin marcar nada', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.buscarUltimoPago.mockResolvedValue(pagoMp({ status: 'in_process' }));
    expect((await servicio.consultarEstado(3101, CLIENTA)).estado).toBe('pendiente');
    expect(pedido.estado).toBe('pendiente_pago');
  });

  it('regreso con pago rechazado: responde rechazado sin marcar nada', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.buscarUltimoPago.mockResolvedValue(pagoMp({ status: 'rejected' }));
    expect((await servicio.consultarEstado(3101, CLIENTA)).estado).toBe('rechazado');
    expect(pedido.estado).toBe('pendiente_pago');
  });
});

describe('Verificación activa sin sesión (tarea periódica)', () => {
  beforeEach(() => {
    process.env = { ...ENV_ORIGINAL, MP_ENTORNO: 'dev' };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    jest.restoreAllMocks();
  });

  it('webhook que no llega: el pago aprobado en Mercado Pago se aplica al pedido', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.buscarUltimoPago.mockImplementation(async (ref: string) => (ref === 'dev-3101' ? pagoMp() : null));
    cliente.obtenerPago.mockResolvedValue(pagoMp());
    await expect(servicio.verificarPedidoPendiente(3101)).resolves.toBe('pagado');
    expect(pedido.estado).toBe('pagado');
  });

  it('sin pago aprobado (pendiente o sin intento) devuelve null y no escribe', async () => {
    const { servicio, cliente, pedido } = montar();
    cliente.buscarUltimoPago.mockResolvedValueOnce(pagoMp({ status: 'pending' }));
    await expect(servicio.verificarPedidoPendiente(3101)).resolves.toBeNull();
    cliente.buscarUltimoPago.mockResolvedValue(null);
    await expect(servicio.verificarPedidoPendiente(3101)).resolves.toBeNull();
    expect(pedido.estado).toBe('pendiente_pago');
    expect(cliente.obtenerPago).not.toHaveBeenCalled();
  });
});
