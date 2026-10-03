import { EstadoPedido } from '@prisma/client';
import { PagosEnLineaService } from './pagos-en-linea.service';
import type { PagoMercadoPago } from './mercadopago.client';

const CLIENTA = 'clienta-1';
const CREADO = new Date('2026-10-03T16:00:00.000Z');

/** Prisma en memoria para un pedido: updateMany condicional por estado y createMany con la llave única
 *  (proveedor, referenciaExterna), como hace Postgres con el índice único y skipDuplicates. */
function montar(pedidoInicial: Partial<{ estado: EstadoPedido; metodoPago: string; total: number; usuarioId: string; creadoEn: Date }> = {}) {
  const pedido = {
    id: 42,
    usuarioId: CLIENTA,
    estado: EstadoPedido.pendiente_pago as EstadoPedido,
    metodoPago: 'mercado_pago',
    total: 500,
    creadoEn: CREADO,
    pagadoEn: null as Date | null,
    referenciaPago: null as string | null,
    items: [
      { presentacionId: 7, cantidad: 2, precioUnitario: 150, nombreProducto: 'Shampoo', tamanio: '250 ml' },
      { presentacionId: 9, cantidad: 1, precioUnitario: 200, nombreProducto: 'Mascarilla', tamanio: null },
    ],
    ...pedidoInicial,
  };
  const pagos: Record<string, unknown>[] = [];
  const historial: Record<string, unknown>[] = [];
  const tx = {
    pedido: {
      updateMany: jest.fn(async ({ where, data }: { where: { id: number; estado: EstadoPedido }; data: Record<string, unknown> }) => {
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
    historialEstadoPedido: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => historial.push(data)) },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(async () => ({ ...pedido, items: pedido.items.map((i) => ({ ...i })) })) },
    permisoRol: { findUnique: jest.fn(async () => ({ claves: [] })) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = { getRol: jest.fn(async (id: string) => (id === 'admin-1' ? 'admin' : 'cliente')) };
  const cliente = {
    obtenerPago: jest.fn<Promise<PagoMercadoPago>, [string]>(),
    buscarUltimoPago: jest.fn<Promise<PagoMercadoPago | null>, [string]>(),
    crearPreferencia: jest.fn(async () => ({ id: 'pref-1', init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref-1' })),
  };
  const eventos = { emit: jest.fn() };
  const servicio = new PagosEnLineaService(prisma as any, access as any, cliente as any, eventos as any);
  return { servicio, pedido, pagos, historial, cliente, eventos };
}

const pagoMp = (cambio: Partial<PagoMercadoPago> = {}): PagoMercadoPago => ({
  id: 777,
  status: 'approved',
  status_detail: 'accredited',
  transaction_amount: 500,
  currency_id: 'MXN',
  external_reference: '42',
  date_approved: '2026-10-03T17:00:00.000-06:00',
  ...cambio,
});

describe('Pago en línea: procesar la notificación consultando a Mercado Pago', () => {
  it('pago aprobado con el monto exacto marca el pedido pagado una sola vez, aunque llegue dos veces', async () => {
    const { servicio, pedido, pagos, historial, cliente, eventos } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp());

    expect(await servicio.procesarPago('777')).toBe('pagado');
    expect(await servicio.procesarPago('777')).toBe('ya_procesado');

    expect(pedido.estado).toBe('pagado');
    expect(pedido.referenciaPago).toBe('777');
    expect((pedido.pagadoEn as Date).toISOString()).toBe('2026-10-03T23:00:00.000Z');
    expect(pagos).toEqual([expect.objectContaining({ estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '777', monto: 500, metodo: 'mercado_pago' })]);
    expect(historial).toHaveLength(1);
    expect(eventos.emit).toHaveBeenCalledTimes(1);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.pagado', { pedidoId: 42, usuarioId: CLIENTA });
  });

  it('un monto distinto no marca pagado: queda en revisión, registrado una vez', async () => {
    const { servicio, pedido, pagos, eventos, cliente } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ transaction_amount: 499.99 }));

    expect(await servicio.procesarPago('777')).toBe('revision');
    expect(await servicio.procesarPago('777')).toBe('ya_procesado');

    expect(pedido.estado).toBe('pendiente_pago');
    expect(pagos).toEqual([expect.objectContaining({ estado: 'en_revision', referenciaExterna: '777' })]);
    expect(eventos.emit).toHaveBeenCalledTimes(1);
    expect(eventos.emit).toHaveBeenCalledWith('pago.requiere_revision', expect.objectContaining({ pedidoId: 42, motivo: 'monto_distinto' }));
  });

  it('otra moneda cuenta como monto distinto', async () => {
    const { servicio, pedido, cliente } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ currency_id: 'USD' }));
    expect(await servicio.procesarPago('777')).toBe('revision');
    expect(pedido.estado).toBe('pendiente_pago');
  });

  it.each(['rejected', 'cancelled', 'in_process', 'pending'])('pago %s: el pedido sigue pendiente y no se registra nada', async (status) => {
    const { servicio, pedido, pagos, eventos, cliente } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ status }));
    expect(await servicio.procesarPago('777')).toBe('no_aprobado');
    expect(pedido.estado).toBe('pendiente_pago');
    expect(pagos).toHaveLength(0);
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it('pago aprobado de un pedido cancelado: no cambia el pedido, se registra una vez y avisa una vez al admin', async () => {
    const { servicio, pedido, pagos, eventos, cliente } = montar({ estado: EstadoPedido.cancelado });
    cliente.obtenerPago.mockResolvedValue(pagoMp());

    expect(await servicio.procesarPago('777')).toBe('revision');
    expect(await servicio.procesarPago('777')).toBe('ya_procesado');

    expect(pedido.estado).toBe('cancelado');
    expect(pagos).toEqual([expect.objectContaining({ estado: 'en_revision', referenciaExterna: '777' })]);
    expect(eventos.emit).toHaveBeenCalledTimes(1);
    expect(eventos.emit).toHaveBeenCalledWith('pago.requiere_revision', { pedidoId: 42, referencia: '777', motivo: 'pedido_no_pendiente', estadoPedido: 'cancelado' });
  });

  it('una referencia que no es un pedido se ignora sin escribir nada', async () => {
    const { servicio, pagos, cliente } = montar();
    cliente.obtenerPago.mockResolvedValue(pagoMp({ external_reference: 'otra-cosa' }));
    expect(await servicio.procesarPago('777')).toBe('ignorado');
    expect(pagos).toHaveLength(0);
  });
});

describe('Pago en línea: crear la preferencia de Mercado Pago', () => {
  const ahora = new Date('2026-10-03T18:00:00.000Z');
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://mirufranco.test';
  });

  it('usa los precios y el total del servidor, la referencia del pedido y vence a las 24 h de creado', async () => {
    const { servicio, cliente } = montar();

    const res = await servicio.crearPreferencia(42, CLIENTA, ahora);

    expect(res).toEqual({ initPoint: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref-1' });
    const [cuerpo, clave] = cliente.crearPreferencia.mock.calls[0] as unknown as [Record<string, any>, string];
    expect(cuerpo.items).toEqual([
      { id: '7', title: 'Shampoo 250 ml', quantity: 2, unit_price: 150, currency_id: 'MXN' },
      { id: '9', title: 'Mascarilla', quantity: 1, unit_price: 200, currency_id: 'MXN' },
    ]);
    expect(cuerpo.external_reference).toBe('42');
    expect(cuerpo.back_urls).toEqual({
      success: 'https://mirufranco.test/cliente/tienda-online/confirmacion?pedidoId=42',
      failure: 'https://mirufranco.test/cliente/tienda-online/confirmacion?pedidoId=42',
      pending: 'https://mirufranco.test/cliente/tienda-online/confirmacion?pedidoId=42',
    });
    expect(cuerpo.expires).toBe(true);
    expect(cuerpo.expiration_date_to).toBe('2026-10-04T16:00:00.000Z');
    expect(cuerpo.payment_methods.excluded_payment_types).toEqual([{ id: 'ticket' }, { id: 'atm' }]);
    expect(typeof clave).toBe('string');
  });

  it('con el sitio en https regresa sola a la confirmación (auto_return); en http local, no (Mercado Pago lo rechaza)', async () => {
    const enHttps = montar();
    await enHttps.servicio.crearPreferencia(42, CLIENTA, ahora);
    expect((enHttps.cliente.crearPreferencia.mock.calls[0] as unknown as [Record<string, unknown>])[0].auto_return).toBe('approved');

    process.env.FRONTEND_URL = 'http://localhost:3005';
    const local = montar();
    await local.servicio.crearPreferencia(42, CLIENTA, ahora);
    const cuerpo = (local.cliente.crearPreferencia.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(cuerpo).not.toHaveProperty('auto_return');
    expect(cuerpo.back_urls.success).toBe('http://localhost:3005/cliente/tienda-online/confirmacion?pedidoId=42');
    process.env.FRONTEND_URL = 'https://mirufranco.test';
  });

  it.each([
    ['otra usuaria', { usuarioId: 'otra' }, 403],
    ['un pedido ya pagado', { estado: EstadoPedido.pagado }, 409],
    ['un pedido de pago al recoger', { metodoPago: 'pago_en_salon' }, 400],
    ['un pedido de hace 25 h (vencido)', { creadoEn: new Date('2026-10-02T17:00:00.000Z') }, 409],
    ['un total que no cuadra con los artículos', { total: 999 }, 409],
  ])('rechaza %s sin llamar a Mercado Pago', async (_caso, cambio, status) => {
    const { servicio, cliente } = montar(cambio);
    await expect(servicio.crearPreferencia(42, CLIENTA, ahora)).rejects.toMatchObject({ status });
    expect(cliente.crearPreferencia).not.toHaveBeenCalled();
  });
});

describe('Pago en línea: estado real para la confirmación', () => {
  it('pendiente con un pago aprobado en Mercado Pago: lo procesa y responde aprobado', async () => {
    const { servicio, pedido, cliente } = montar();
    cliente.buscarUltimoPago.mockResolvedValue(pagoMp());
    cliente.obtenerPago.mockResolvedValue(pagoMp());

    expect(await servicio.consultarEstado(42, CLIENTA)).toEqual({ estado: 'aprobado', pedidoEstado: 'pagado' });
    expect(pedido.estado).toBe('pagado');
  });

  it.each([
    ['rejected', 'rechazado'],
    ['cancelled', 'rechazado'],
    ['in_process', 'pendiente'],
    ['pending', 'pendiente'],
  ])('pago %s en Mercado Pago → %s, sin tocar el pedido', async (status, estado) => {
    const { servicio, pedido, cliente } = montar();
    cliente.buscarUltimoPago.mockResolvedValue(pagoMp({ status }));
    expect(await servicio.consultarEstado(42, CLIENTA)).toEqual({ estado, pedidoEstado: 'pendiente_pago' });
    expect(pedido.estado).toBe('pendiente_pago');
  });

  it('sin intentos de pago responde sin_pago', async () => {
    const { servicio, cliente } = montar();
    cliente.buscarUltimoPago.mockResolvedValue(null);
    expect(await servicio.consultarEstado(42, CLIENTA)).toEqual({ estado: 'sin_pago', pedidoEstado: 'pendiente_pago' });
  });

  it('pedido ya pagado responde aprobado sin consultar a Mercado Pago', async () => {
    const { servicio, cliente } = montar({ estado: EstadoPedido.pagado });
    expect(await servicio.consultarEstado(42, CLIENTA)).toEqual({ estado: 'aprobado', pedidoEstado: 'pagado' });
    expect(cliente.buscarUltimoPago).not.toHaveBeenCalled();
  });

  it('un pedido de pago al recoger no se consulta en Mercado Pago', async () => {
    const { servicio, cliente } = montar({ metodoPago: 'pago_en_salon' });
    expect(await servicio.consultarEstado(42, CLIENTA)).toEqual({ estado: 'sin_pago', pedidoEstado: 'pendiente_pago' });
    expect(cliente.buscarUltimoPago).not.toHaveBeenCalled();
  });

  it('otra usuaria no puede consultar el pedido: 403', async () => {
    const { servicio } = montar();
    await expect(servicio.consultarEstado(42, 'otra')).rejects.toMatchObject({ status: 403 });
  });
});
