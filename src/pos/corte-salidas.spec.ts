import { Prisma } from '@prisma/client';
import { PosService } from './pos.service';
import { AnticiposCitasService } from '../citas/anticipos/anticipos-citas.service';
import { PagosService } from '../ecommerce/pagos/pagos.service';

/**
 * Salidas de efectivo: un reembolso en efectivo saca dinero de la caja de quien lo hace y se descuenta en su
 * siguiente corte, aunque el cobro original sea de un día ya cortado. El corte sigue cuadrando.
 */
const d = (n: number) => new Prisma.Decimal(n);
const DIA_3 = new Date('2026-10-03T16:00:00.000Z'); // 3 oct 10:00 en México
const DIA_4 = new Date('2026-10-04T18:00:00.000Z'); // 4 oct 12:00 en México

// ---------- Prisma en memoria con un filtro "where" genérico ----------
function coincide(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return (cond as any[]).some((w) => coincide(fila, w));
    const v = fila[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond !== 'object') return v === cond;
    return Object.entries(cond).every(([op, x]: [string, any]) => {
      const t = (z: any) => (z instanceof Date ? z.getTime() : z);
      switch (op) {
        case 'in': return (x as any[]).includes(v);
        case 'not':
        case 'isNot': return x === null ? v !== null && v !== undefined : v !== x;
        case 'gte': return v != null && t(v) >= t(x);
        case 'lte': return v != null && t(v) <= t(x);
        default: throw new Error(`Operador no soportado en la prueba: ${op}`);
      }
    });
  });
}

function caja(inicial: { pagos?: any[]; citas?: any[]; ventas?: any[] } = {}) {
  const pagos: any[] = inicial.pagos ?? [];
  const citas: any[] = inicial.citas ?? [];
  const ventas: any[] = inicial.ventas ?? [];
  const movimientos: any[] = [];
  const cortes: any[] = [];
  // Relación 1 a 1 pago → salida, como la resolvería Prisma.
  const conSalida = (p: any) => ({ ...p, salidaCaja: movimientos.find((m) => m.pagoId === p.id) ?? null });
  const actualizar = (filas: any[], where: any, data: any, vista: (f: any) => any = (f) => f) => {
    const r = filas.filter((f) => coincide(vista(f), where));
    r.forEach((f) => Object.assign(f, data));
    return { count: r.length };
  };
  const prisma: any = {
    cita: { findUnique: jest.fn(async ({ where }: any) => citas.find((c) => c.id === where.id) ?? null) },
    pedido: { findUnique: jest.fn(async () => ({ usuarioId: 'clienta-1' })) },
    pago: {
      findMany: jest.fn(async ({ where }: any) => pagos.map(conSalida).filter((p) => coincide(p, where))),
      findFirst: jest.fn(async ({ where }: any) => pagos.map(conSalida).filter((p) => coincide(p, where)).sort((a, b) => b.id - a.id)[0] ?? null),
      findUnique: jest.fn(async ({ where }: any) => pagos.find((p) => p.id === where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => actualizar(pagos, where, data, conSalida)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(pagos.find((p) => p.id === where.id), data)),
    },
    movimientoCaja: {
      create: jest.fn(async ({ data }: any) => {
        // Llave única de pago_id, como en la base.
        if (data.pagoId != null && movimientos.some((m) => m.pagoId === data.pagoId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: ['pago_id'] } });
        }
        const m = { id: movimientos.length + 1, corteId: null, creadoEn: new Date(), ...data };
        movimientos.push(m);
        return m;
      }),
      findMany: jest.fn(async ({ where }: any) => movimientos.filter((m) => coincide(m, where))),
      updateMany: jest.fn(async ({ where, data }: any) => actualizar(movimientos, where, data)),
    },
    ventaLocal: {
      findMany: jest.fn(async ({ where }: any) => ventas.filter((v) => coincide(v, where))),
      updateMany: jest.fn(async ({ where, data }: any) => actualizar(ventas, where, data)),
    },
    corteCaja: {
      create: jest.fn(async ({ data }: any) => {
        const c = { id: cortes.length + 1, ...data };
        cortes.push(c);
        return c;
      }),
    },
  };
  // Reembolsar un pago de pedido revisa, con candado, que no tenga reembolsos por devolución aprobados.
  prisma.devolucion = { count: jest.fn(async () => 0) };
  prisma.$executeRaw = jest.fn(async () => 1);
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const mp = { reembolsarPago: jest.fn(async () => ({ id: 77, status: 'approved' })), obtenerPago: jest.fn() };
  const pos = new PosService(prisma, {} as any, { emit: jest.fn() } as any);
  const anticipos = new AnticiposCitasService(prisma, mp as any, { emit: jest.fn() } as any);
  const pagosSrv = new PagosService(prisma, { getRol: jest.fn() } as any);
  return { prisma, pagos, movimientos, cortes, mp, pos, anticipos, pagosSrv };
}

const citaCancelada = { id: 7, estado: 'cancelada', anticipoRequerido: d(200), anticipoPagadoEn: DIA_3 };
const anticipoEnEfectivo = (pagadoEn: Date) => ({
  id: 1, citaId: 7, pedidoId: null, estado: 'aprobado', monto: d(200), metodo: 'efectivo', proveedor: null,
  referenciaExterna: null, cobradoPorId: 'cajera-1', pagadoEn, corteId: null, retenidoEn: null,
});
const corteDel = (fecha: string, efectivoInicial: number, efectivoFinal: number) => ({ fecha, efectivoInicial, efectivoFinal });

describe('Corte de caja con salidas de efectivo', () => {
  afterEach(() => jest.useRealTimers());

  it('mismo día: cobro de 200 y su reembolso en efectivo; el corte muestra ambos y cuadra', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(new Date('2026-10-04T16:00:00.000Z'))] });

    await c.anticipos.reembolsar(7, 'cajera-1');
    const r = await c.pos.crearCorte(corteDel('2026-10-04', 500, 500), 'cajera-1');

    const corte = c.cortes[0];
    expect(Number(corte.totalEfectivo)).toBe(200);
    expect(Number(corte.totalSalidas)).toBe(200);
    expect(Number(corte.diferencia)).toBe(0);
    expect(c.movimientos[0].corteId).toBe(corte.id);
    expect(c.pagos[0].corteId).toBe(corte.id);
    expect(r.data.movimientos).toHaveLength(1);
  });

  it('día ya cortado: el corte del día 3 no cambia y el reembolso del día 4 entra al corte del día 4', async () => {
    jest.useFakeTimers({ now: DIA_3 });
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    await c.pos.crearCorte(corteDel('2026-10-03', 500, 700), 'cajera-1');
    const delDia3 = { ...c.cortes[0] };
    expect(Number(delDia3.totalEfectivo)).toBe(200);
    expect(Number(delDia3.diferencia)).toBe(0);

    jest.setSystemTime(DIA_4);
    await c.anticipos.reembolsar(7, 'cajera-1');
    // Al día 4 la cajera empieza con lo que dejó el día 3 (700) y entrega 200.
    await c.pos.crearCorte(corteDel('2026-10-04', 700, 500), 'cajera-1');

    expect(c.cortes[0]).toEqual(delDia3);
    const delDia4 = c.cortes[1];
    expect(Number(delDia4.totalEfectivo)).toBe(0);
    expect(Number(delDia4.totalSalidas)).toBe(200);
    expect(Number(delDia4.diferencia)).toBe(0);
    expect(c.movimientos[0].corteId).toBe(delDia4.id);
  });

  it('una salida no entra en dos cortes', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    c.pagos[0].corteId = 99; // el cobro ya se cortó el día 3
    await c.anticipos.reembolsar(7, 'cajera-1');

    await c.pos.crearCorte(corteDel('2026-10-04', 500, 300), 'cajera-1');
    await c.pos.crearCorte(corteDel('2026-10-04', 300, 300), 'cajera-1');

    expect(Number(c.cortes[0].totalSalidas)).toBe(200);
    expect(Number(c.cortes[1].totalSalidas)).toBe(0);
    expect(Number(c.cortes[1].diferencia)).toBe(0);
  });

  it('si otro corte se llevó la salida entre la lectura y el guardado, el corte se rechaza (409)', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    c.pagos[0].corteId = 99;
    await c.anticipos.reembolsar(7, 'cajera-1');
    const leer = c.prisma.movimientoCaja.findMany.getMockImplementation();
    c.prisma.movimientoCaja.findMany.mockImplementationOnce(async (args: any) => {
      const filas = await leer(args);
      c.movimientos[0].corteId = 98; // otro corte simultáneo la tomó
      return filas;
    });

    await expect(c.pos.crearCorte(corteDel('2026-10-04', 500, 300), 'cajera-1')).rejects.toMatchObject({ status: 409 });
  });

  it('una salida de otra cajera o de un día posterior no entra en el corte', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    c.pagos[0].corteId = 99;
    await c.anticipos.reembolsar(7, 'otra-cajera');

    await c.pos.crearCorte(corteDel('2026-10-04', 500, 500), 'cajera-1');
    await c.pos.crearCorte(corteDel('2026-10-03', 500, 500), 'otra-cajera');

    expect(Number(c.cortes[0].totalSalidas)).toBe(0);
    expect(Number(c.cortes[1].totalSalidas)).toBe(0);
    expect(c.movimientos[0].corteId).toBeNull();
  });

  it('un pago reembolsado sin salida (anterior a este cambio) no cuenta como cobro del corte', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ pagos: [{ ...anticipoEnEfectivo(DIA_4), estado: 'reembolsado' }] });
    await c.pos.crearCorte(corteDel('2026-10-04', 0, 0), 'cajera-1');
    expect(Number(c.cortes[0].totalEfectivo)).toBe(0);
    expect(Number(c.cortes[0].diferencia)).toBe(0);
  });

  it('obtener un corte trae sus salidas con concepto, monto, motivo y referencia', async () => {
    const c = caja();
    c.prisma.corteCaja.findUnique = jest.fn(async () => ({ id: 1 }));
    await c.pos.obtenerCorte(1);
    const include = c.prisma.corteCaja.findUnique.mock.calls[0][0].include;
    expect(include.movimientos.select).toMatchObject({ concepto: true, monto: true, motivo: true, pagoId: true, devolucionId: true });
  });
});

describe('Reembolso del anticipo y salida de caja', () => {
  afterEach(() => jest.useRealTimers());

  it('un anticipo cobrado en efectivo en el salón registra la salida a nombre de quien reembolsa', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    await c.anticipos.reembolsar(7, 'gerente-1');
    expect(c.pagos[0].estado).toBe('reembolsado');
    expect(c.pagos[0].reembolsadoEn).toEqual(DIA_4);
    expect(c.movimientos).toHaveLength(1);
    expect(c.movimientos[0]).toMatchObject({ concepto: 'reembolso_anticipo', registradoPorId: 'gerente-1', pagoId: 1 });
    expect(Number(c.movimientos[0].monto)).toBe(200);
  });

  it.each([
    ['tarjeta en el salón', { metodo: 'tarjeta_terminal' }],
    ['Mercado Pago', { metodo: 'mercado_pago', proveedor: 'mercadopago', referenciaExterna: '555', cobradoPorId: null }],
  ])('un anticipo pagado con %s no crea salida de efectivo', async (_n, extra) => {
    const c = caja({ citas: [citaCancelada], pagos: [{ ...anticipoEnEfectivo(DIA_3), ...extra }] });
    await c.anticipos.reembolsar(7, 'cajera-1');
    expect(c.pagos[0].estado).toBe('reembolsado');
    expect(c.pagos[0].reembolsadoEn).toBeInstanceOf(Date);
    expect(c.movimientos).toHaveLength(0);
  });

  it('reembolsar dos veces responde 409 y deja una sola salida', async () => {
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    await c.anticipos.reembolsar(7, 'cajera-1');
    await expect(c.anticipos.reembolsar(7, 'cajera-1')).rejects.toMatchObject({ status: 409 });
    expect(c.movimientos).toHaveLength(1);
  });

  it('si ya existe la salida de ese pago (reembolso simultáneo), la llave única se traduce a 409', async () => {
    const c = caja({ citas: [citaCancelada], pagos: [anticipoEnEfectivo(DIA_3)] });
    await c.prisma.movimientoCaja.create({ data: { tipo: 'salida', concepto: 'reembolso_anticipo', monto: d(200), registradoPorId: 'otra', pagoId: 1 } });
    await expect(c.anticipos.reembolsar(7, 'cajera-1')).rejects.toMatchObject({ status: 409 });
  });
});

describe('Reembolso de un pedido y salida de caja', () => {
  afterEach(() => jest.useRealTimers());
  const cobroPedido = (extra: Record<string, unknown> = {}) => ({
    id: 5, pedidoId: 12, citaId: null, estado: 'aprobado', monto: d(350), metodo: 'efectivo', proveedor: null,
    cobradoPorId: 'cajera-1', pagadoEn: DIA_3, corteId: null, ...extra,
  });
  const reembolsar = (c: ReturnType<typeof caja>, quien = 'cajera-2') =>
    c.pagosSrv.actualizar(5, quien, { estado: 'reembolsado' } as any, 'estilista', ['caja:escritura']);

  it('un cobro en efectivo del salón registra la salida y la fecha del reembolso', async () => {
    jest.useFakeTimers({ now: DIA_4 });
    const c = caja({ pagos: [cobroPedido()] });
    await reembolsar(c);
    expect(c.pagos[0]).toMatchObject({ estado: 'reembolsado', reembolsadoEn: DIA_4 });
    expect(c.movimientos[0]).toMatchObject({ concepto: 'reembolso_pedido', registradoPorId: 'cajera-2', pagoId: 5 });
    expect(Number(c.movimientos[0].monto)).toBe(350);
  });

  it('un cobro con tarjeta o en línea no crea salida', async () => {
    const c = caja({ pagos: [cobroPedido({ metodo: 'tarjeta_terminal' })] });
    await reembolsar(c);
    expect(c.pagos[0].estado).toBe('reembolsado');
    expect(c.movimientos).toHaveLength(0);
  });

  it('reembolsar dos veces responde 409', async () => {
    const c = caja({ pagos: [cobroPedido()] });
    await reembolsar(c);
    await expect(reembolsar(c)).rejects.toMatchObject({ status: 409 });
    expect(c.movimientos).toHaveLength(1);
  });

  it('un pago pendiente o rechazado no se marca como reembolsado (409)', async () => {
    const c = caja({ pagos: [cobroPedido({ estado: 'pendiente', cobradoPorId: null, pagadoEn: null })] });
    await expect(reembolsar(c)).rejects.toMatchObject({ status: 409 });
    expect(c.pagos[0].estado).toBe('pendiente');
  });
});
