import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { CitasService } from '../citas.service';
import { PagosEnLineaService } from '../../ecommerce/mercadopago/pagos-en-linea.service';
import { PagosEnLineaController } from '../../ecommerce/mercadopago/pagos-en-linea.controller';
import { PosService } from '../../pos/pos.service';
import { ServiciosController } from '../../servicios/servicios.controller';
import { ServiciosService } from '../../servicios/servicios.service';
import { AnticiposCitasService } from './anticipos-citas.service';
import { AnticiposCitasController } from './anticipos-citas.controller';
import { AnticiposBarridaService } from './anticipos-barrida.service';
import { PLAZO_ANTICIPO_MS, citaDeReferencia, referenciaCita } from './anticipos.util';

/**
 * Anticipo de citas: agendar en línea lo pide, se paga con Mercado Pago o en el salón, la barrida libera
 * las citas sin pagar, el POS lo descuenta y el personal reembolsa, retiene o marca "no asistió".
 */
const AHORA = new Date('2026-10-20T16:00:00.000Z');
const minutos = (m: number) => new Date(AHORA.getTime() + m * 60_000);
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['ventas:escritura', 'caja:escritura', 'caja:lectura', 'citas:escritura', 'servicios:lectura', 'servicios:escritura', 'pedidos:entregar'],
  empleado: ['ventas:escritura', 'citas:escritura', 'servicios:lectura', 'pedidos:entregar'],
  becario: ['citas:asignadas', 'servicios:lectura', 'clientes:lectura'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};
const yo = (rol: string) => ({ id: `${rol}-yo`, rol, claves: CLAVES[rol] });
/** Horario real del salón: crear y reprogramar solo aceptan citas dentro de él. */
const CONFIGURACION = {
  obtener: async () => ({ data: { entradaLunesViernes: '09:30', salidaLunesViernes: '19:30', entradaSabado: '09:30', salidaSabado: '19:00', entradaDomingo: null, salidaDomingo: null } }),
};

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
      const n = (z: any) => (z instanceof Date ? z.getTime() : z instanceof Prisma.Decimal ? Number(z) : typeof z === 'object' && z !== null ? Number(z) : z);
      switch (op) {
        case 'in': return (x as any[]).includes(v);
        case 'not': return x === null ? v !== null && v !== undefined : v !== x;
        case 'gt': return v !== null && v !== undefined && n(v) > n(x);
        case 'gte': return v !== null && v !== undefined && n(v) >= n(x);
        case 'lt': return v !== null && v !== undefined && n(v) < n(x);
        case 'lte': return v !== null && v !== undefined && n(v) <= n(x);
        default: return coincide(v ?? {}, { [op]: x });
      }
    });
  });
}

function base(opciones: { citas?: any[]; pagos?: any[]; fallaCita?: number } = {}) {
  const citas: any[] = (opciones.citas ?? []).map((c) => ({ estado: 'pendiente', anticipoPagadoEn: null, creadoEn: minutos(-150), clienteId: 'cliente-yo', especialistaId: 'est-1', servicioId: 5, ...c }));
  const pagos: any[] = opciones.pagos ?? [];
  const movimientos: any[] = [];
  let sigPago = 900;
  const conRelaciones = (c: any) => c && { ...c, servicio: { id: c.servicioId, nombre: 'Nanoplastia', precio: new Prisma.Decimal(900), duracionMinutos: 60 }, pagos: pagos.filter((p) => p.citaId === c.id) };
  const prisma: any = {
    cita: {
      findUnique: jest.fn(async ({ where }: any) => conRelaciones(citas.find((c) => c.id === where.id))),
      findMany: jest.fn(async ({ where, take, orderBy }: any) => {
        let r = citas.filter((c) => coincide(c, where));
        if (orderBy?.id === 'asc') r = r.sort((a, b) => a.id - b.id);
        return (take ? r.slice(0, take) : r).map(conRelaciones);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (opciones.fallaCita !== undefined && where.id === opciones.fallaCita) throw new Error('timeout');
        const r = citas.filter((c) => coincide(c, where));
        r.forEach((c) => Object.assign(c, data));
        return { count: r.length };
      }),
      update: jest.fn(async ({ where, data }: any) => { const c = citas.find((x) => x.id === where.id); Object.assign(c, data); return conRelaciones(c); }),
    },
    pago: {
      findMany: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where))),
      findFirst: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where)).sort((a, b) => b.id - a.id)[0] ?? null),
      create: jest.fn(async ({ data }: any) => { const p = { id: sigPago++, ...data }; pagos.push(p); return p; }),
      createMany: jest.fn(async ({ data }: any) => {
        let count = 0;
        for (const d of data) {
          if (pagos.some((p) => p.proveedor === d.proveedor && p.referenciaExterna === d.referenciaExterna && d.referenciaExterna)) continue;
          pagos.push({ id: sigPago++, ...d });
          count++;
        }
        return { count };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => { const r = pagos.filter((p) => coincide(p, where)); r.forEach((p) => Object.assign(p, data)); return { count: r.length }; }),
      aggregate: jest.fn(async ({ where }: any) => ({ _sum: { monto: pagos.filter((p) => coincide(p, where)).reduce((s, p) => s + Number(p.monto), 0) } })),
    },
    movimientoCaja: { create: jest.fn(async ({ data }: any) => { const m = { id: movimientos.length + 1, corteId: null, ...data }; movimientos.push(m); return m; }) },
  };
  prisma.$transaction = jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const eventos = { emit: jest.fn() };
  const mp = {
    crearPreferencia: jest.fn(async (_cuerpo: unknown, _clave: string) => ({ id: "pref-1", init_point: "https://mp.test/pagar" })),
    obtenerPago: jest.fn(),
    buscarUltimoPago: jest.fn(async () => null),
    reembolsarPago: jest.fn(async () => ({ id: 77, status: 'approved' })),
  };
  const anticipos = new AnticiposCitasService(prisma, mp as any, eventos as any);
  return { prisma, citas, pagos, movimientos, eventos, mp, anticipos };
}

const citaConAnticipo = (extra: Record<string, unknown> = {}) => ({ id: 7, anticipoRequerido: new Prisma.Decimal(150), anticipoVenceEn: minutos(60), ...extra });

/** CitasService.crear con Prisma simulado: `creadas` guarda el `data` de cada cita creada. */
function montarCitas(anticipoMonto: number | null) {
  const creadas: any[] = [];
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id === 'est-1' ? 'estilista' : 'cliente', activo: true })) },
    servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, duracionMinutos: 60, anticipoMonto: anticipoMonto === null ? null : new Prisma.Decimal(anticipoMonto) })) },
    cita: {
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => { creadas.push(data); return { id: 1, ...data, servicio: { nombre: 'Nanoplastia' } }; }),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return { servicio: new CitasService(prisma, {} as any, CONFIGURACION as any, { emit: jest.fn() } as any), creadas, prisma };
}

/** CitasService sobre el Prisma en memoria de `base` (cancelar, reprogramar, no asistió). */
function citasCon(cita: any, pagos: any[]) {
  const b = base({ citas: [cita], pagos });
  b.prisma.cita.findFirst = jest.fn(async () => null);
  b.prisma.$executeRaw = jest.fn(async () => 1);
  const citasSrv = new CitasService(b.prisma, {} as any, CONFIGURACION as any, b.eventos as any);
  return { ...b, citasSrv };
}

// ---------- 1. Agendar ----------
describe('Agendar: el anticipo sale del servicio y aparta el horario 2 horas', () => {
  beforeAll(() => { jest.useFakeTimers({ now: AHORA }); process.env.ANTICIPOS_DESDE = '2026-10-01'; });
  afterAll(() => { jest.useRealTimers(); delete process.env.ANTICIPOS_DESDE; });

  const dto = { clienteId: 'otra', especialistaId: 'est-1', servicioId: 5, fechaHoraInicio: '2026-10-21T16:00:00.000Z', fechaHoraFin: '2026-10-21T17:00:00.000Z' };

  it.each(['cliente', 'estilista', 'empleado', 'becario', 'admin'])('desde el portal (%s) la cita guarda el anticipo y vence en 2 horas', async (rol) => {
    const { servicio, creadas } = montarCitas(150);
    await servicio.crear(dto as any, yo(rol), true);
    expect(Number(creadas[0].anticipoRequerido)).toBe(150);
    expect(creadas[0].anticipoVenceEn).toEqual(new Date(AHORA.getTime() + PLAZO_ANTICIPO_MS));
    expect(creadas[0].estado ?? 'pendiente').toBe('pendiente');
  });

  it('sin monto o con 0 no pide anticipo', async () => {
    for (const monto of [null, 0]) {
      const { servicio, creadas } = montarCitas(monto);
      await servicio.crear(dto as any, yo('cliente'), true);
      expect(creadas[0].anticipoRequerido ?? null).toBeNull();
      expect(creadas[0].anticipoVenceEn ?? null).toBeNull();
    }
  });

  it('desde /operacion no pide anticipo, salvo que el personal lo marque', async () => {
    const a = montarCitas(150);
    await a.servicio.crear(dto as any, yo('estilista'), false);
    expect(a.creadas[0].anticipoRequerido ?? null).toBeNull();
    const b = montarCitas(150);
    await b.servicio.crear({ ...dto, pedirAnticipo: true } as any, yo('estilista'), false);
    expect(Number(b.creadas[0].anticipoRequerido)).toBe(150);
  });
});

// ---------- 2. Preferencia de Mercado Pago ----------
describe('Preferencia del anticipo', () => {
  it('solo la dueña; monto del servidor, referencia de cita, sin ticket ni atm y vence con el anticipo', async () => {
    const { anticipos, mp } = base({ citas: [citaConAnticipo()] });
    const r = await anticipos.crearPreferencia(7, 'cliente-yo', AHORA);
    expect(r.initPoint).toBe('https://mp.test/pagar');
    const cuerpo = mp.crearPreferencia.mock.calls[0][0] as any;
    expect(cuerpo.external_reference).toBe('cita-7');
    expect(cuerpo.items).toEqual([expect.objectContaining({ quantity: 1, unit_price: 150, currency_id: 'MXN' })]);
    expect(cuerpo.payment_methods.excluded_payment_types).toEqual([{ id: 'ticket' }, { id: 'atm' }]);
    expect(cuerpo.expires).toBe(true);
    expect(cuerpo.expiration_date_to).toBe(minutos(60).toISOString());
    expect(cuerpo.back_urls.success).toContain('/cliente/servicios-citas/confirmacion?citaId=7');
  });

  it('la cita de otra persona responde 404 aunque sea personal', async () => {
    const { anticipos } = base({ citas: [citaConAnticipo()] });
    await expect(anticipos.crearPreferencia(7, 'estilista-yo', AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin anticipo, ya pagada, vencida o cancelada no se crea', async () => {
    await expect(base({ citas: [citaConAnticipo({ anticipoRequerido: null })] }).anticipos.crearPreferencia(7, 'cliente-yo', AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(base({ citas: [citaConAnticipo({ anticipoPagadoEn: minutos(-5) })] }).anticipos.crearPreferencia(7, 'cliente-yo', AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(base({ citas: [citaConAnticipo({ anticipoVenceEn: minutos(-1) })] }).anticipos.crearPreferencia(7, 'cliente-yo', AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(base({ citas: [citaConAnticipo({ estado: 'cancelada' })] }).anticipos.crearPreferencia(7, 'cliente-yo', AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('referencias: cita-<id> se distingue de un pedido', () => {
    expect(referenciaCita(7)).toBe('cita-7');
    expect(citaDeReferencia('cita-7')).toBe(7);
    expect([citaDeReferencia('7'), citaDeReferencia('cita-x'), citaDeReferencia(undefined)]).toEqual([null, null, null]);
  });
});

// ---------- 3. Webhook ----------
const pagoMp = (extra: Record<string, unknown> = {}) => ({ id: 555, status: 'approved', transaction_amount: 150, currency_id: 'MXN', external_reference: 'cita-7', date_approved: minutos(-10).toISOString(), ...extra });

describe('Webhook de anticipos', () => {
  function conWebhook(citas: any[]) {
    const b = base({ citas });
    const pagosEnLinea = new PagosEnLineaService({ pedido: { findUnique: jest.fn() } } as any, {} as any, b.mp as any, b.eventos as any, b.anticipos);
    return { ...b, pagosEnLinea };
  }

  it('aprobado y a tiempo: marca el anticipo, confirma la cita y guarda el pago ligado a la cita', async () => {
    const { pagosEnLinea, mp, citas, pagos } = conWebhook([citaConAnticipo()]);
    mp.obtenerPago.mockResolvedValue(pagoMp());
    await expect(pagosEnLinea.procesarPago('555')).resolves.toBe('pagado');
    expect(citas[0]).toMatchObject({ estado: 'confirmada' });
    expect(citas[0].anticipoPagadoEn).toBeInstanceOf(Date);
    expect(pagos).toEqual([expect.objectContaining({ citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555' })]);
    expect(pagos[0].pedidoId ?? null).toBeNull();
  });

  it('webhook repetido: no duplica nada', async () => {
    const { pagosEnLinea, mp, pagos } = conWebhook([citaConAnticipo()]);
    mp.obtenerPago.mockResolvedValue(pagoMp());
    await pagosEnLinea.procesarPago('555');
    await expect(pagosEnLinea.procesarPago('555')).resolves.toBe('ya_procesado');
    expect(pagos).toHaveLength(1);
  });

  it('pago tardío (la cita ya se liberó): el pago queda en revisión y se avisa al personal', async () => {
    const { pagosEnLinea, mp, pagos, eventos, citas } = conWebhook([citaConAnticipo({ estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado' })]);
    mp.obtenerPago.mockResolvedValue(pagoMp());
    await expect(pagosEnLinea.procesarPago('555')).resolves.toBe('revision');
    expect(pagos[0]).toMatchObject({ citaId: 7, estado: 'en_revision' });
    expect(citas[0].anticipoPagadoEn).toBeNull();
    expect(eventos.emit).toHaveBeenCalledWith('pago.requiere_revision', expect.objectContaining({ citaId: 7, referencia: '555' }));
  });

  it('monto distinto: en revisión, la cita no se confirma', async () => {
    const { pagosEnLinea, mp, pagos, citas } = conWebhook([citaConAnticipo()]);
    mp.obtenerPago.mockResolvedValue(pagoMp({ transaction_amount: 1 }));
    await expect(pagosEnLinea.procesarPago('555')).resolves.toBe('revision');
    expect(pagos[0].estado).toBe('en_revision');
    expect(citas[0].estado).toBe('pendiente');
  });

  it('no aprobado no escribe nada', async () => {
    const { pagosEnLinea, mp, pagos } = conWebhook([citaConAnticipo()]);
    mp.obtenerPago.mockResolvedValue(pagoMp({ status: 'rejected' }));
    await expect(pagosEnLinea.procesarPago('555')).resolves.toBe('no_aprobado');
    expect(pagos).toHaveLength(0);
  });

  it('firma inválida: 401 y no se consulta ningún pago', async () => {
    const servicio = { procesarPago: jest.fn() };
    const controller = new PagosEnLineaController(servicio as any);
    process.env.MP_WEBHOOK_SECRET = 'secreto-de-prueba';
    const req: any = { query: { 'data.id': '555' } };
    await expect(controller.webhook(req, 'ts=1,v1=abcdef', 'req-1', 'payment', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(servicio.procesarPago).not.toHaveBeenCalled();
    const v1 = createHmac('sha256', 'secreto-de-prueba').update('id:555;request-id:req-1;ts:1;').digest('hex');
    await controller.webhook(req, `ts=1,v1=${v1}`, 'req-1', 'payment', undefined);
    expect(servicio.procesarPago).toHaveBeenCalledWith('555');
  });

  it('el estado para la confirmación se consulta a Mercado Pago, no a la URL', async () => {
    const { anticipos, mp } = base({ citas: [citaConAnticipo()] });
    mp.buscarUltimoPago.mockResolvedValue(pagoMp() as any);
    mp.obtenerPago.mockResolvedValue(pagoMp());
    const r = await anticipos.consultarEstado(7, yo('cliente'), AHORA);
    expect(mp.buscarUltimoPago).toHaveBeenCalledWith('cita-7');
    expect(r.estado).toBe('aprobado');
  });
});

// ---------- 4. Anticipo en el salón ----------
describe('Registrar el anticipo en el salón', () => {
  it('tarjeta entra al corte como tarjeta_terminal, con quién cobró; la cita se confirma', async () => {
    const { anticipos, pagos, citas } = base({ citas: [citaConAnticipo()] });
    await anticipos.registrarEnSalon(7, 'tarjeta', 'estilista-yo', AHORA);
    expect(pagos[0]).toMatchObject({ citaId: 7, metodo: 'tarjeta_terminal', estado: 'aprobado', cobradoPorId: 'estilista-yo', pagadoEn: AHORA });
    expect(Number(pagos[0].monto)).toBe(150);
    expect(citas[0]).toMatchObject({ estado: 'confirmada', anticipoPagadoEn: AHORA });
  });

  it('doble cobro: el segundo responde 409 y no crea otro pago', async () => {
    const { anticipos, pagos } = base({ citas: [citaConAnticipo()] });
    await anticipos.registrarEnSalon(7, 'efectivo', 'estilista-yo', AHORA);
    await expect(anticipos.registrarEnSalon(7, 'efectivo', 'empleado-yo', AHORA)).rejects.toBeInstanceOf(ConflictException);
    expect(pagos).toHaveLength(1);
  });

  it('una cita sin anticipo o ya cancelada no lo acepta', async () => {
    await expect(base({ citas: [citaConAnticipo({ anticipoRequerido: null })] }).anticipos.registrarEnSalon(7, 'efectivo', 'x', AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(base({ citas: [citaConAnticipo({ estado: 'cancelada' })] }).anticipos.registrarEnSalon(7, 'efectivo', 'x', AHORA)).rejects.toBeInstanceOf(ConflictException);
  });
});

// ---------- 5. Barrida ----------
describe('Barrida de anticipos vencidos', () => {
  afterEach(() => { delete process.env.ANTICIPOS_DESDE; });

  it('sin ANTICIPOS_DESDE no cancela nada', async () => {
    const b = base({ citas: [citaConAnticipo({ anticipoVenceEn: minutos(-1) })] });
    const barrida = new AnticiposBarridaService(b.prisma, b.eventos as any);
    await expect(barrida.barrer(AHORA)).resolves.toEqual({ desactivada: true });
    expect(b.citas[0].estado).toBe('pendiente');
  });

  it('más de 50 citas: lotes de 50 por id, una que falla no detiene las demás', async () => {
    process.env.ANTICIPOS_DESDE = '2026-10-01';
    const vencidas = Array.from({ length: 120 }, (_, i) => citaConAnticipo({ id: i + 1, anticipoVenceEn: minutos(-1) }));
    const otras = [
      citaConAnticipo({ id: 500, anticipoVenceEn: minutos(30) }), // aún a tiempo
      citaConAnticipo({ id: 501, anticipoVenceEn: minutos(-5), anticipoPagadoEn: minutos(-30), estado: 'confirmada' }), // pagada
      citaConAnticipo({ id: 502, anticipoVenceEn: minutos(-5), creadoEn: new Date('2026-09-01T12:00:00Z') }), // antes de ANTICIPOS_DESDE
      { id: 503, anticipoRequerido: null, anticipoVenceEn: null }, // sin anticipo
    ];
    const b = base({ citas: [...vencidas, ...otras], fallaCita: 2 });
    const barrida = new AnticiposBarridaService(b.prisma, b.eventos as any);
    const r: any = await barrida.barrer(AHORA);
    expect(b.prisma.cita.findMany.mock.calls.map((c: any) => c[0].take)).toEqual([50, 50, 50]);
    expect(r.canceladas).toHaveLength(119);
    expect(r.canceladas).not.toContain(2);
    const estado = (id: number) => b.citas.find((c) => c.id === id).estado;
    expect([estado(1), estado(2), estado(120), estado(500), estado(501), estado(502), estado(503)]).toEqual(['cancelada', 'pendiente', 'cancelada', 'pendiente', 'confirmada', 'pendiente', 'pendiente']);
    expect(b.citas.find((c) => c.id === 1).motivoCancelacion).toBe('anticipo_no_pagado');
    expect(b.eventos.emit).toHaveBeenCalledWith('cita.cancelada', expect.objectContaining({ citaId: 1, clienteId: 'cliente-yo' }));
  });

  it('si se pagó un instante antes de cancelar, no se toca (update condicional)', async () => {
    process.env.ANTICIPOS_DESDE = '2026-10-01';
    const b = base({ citas: [citaConAnticipo({ anticipoVenceEn: minutos(-1) })] });
    b.prisma.cita.findMany.mockImplementationOnce(async () => {
      const filas = [{ ...b.citas[0] }];
      b.citas[0].anticipoPagadoEn = AHORA; // el webhook llegó entre la lectura y la cancelación
      return filas;
    });
    const r: any = await new AnticiposBarridaService(b.prisma, b.eventos as any).barrer(AHORA);
    expect(r.canceladas).toEqual([]);
    expect(b.citas[0].estado).toBe('pendiente');
  });
});

// ---------- 6. POS ----------
describe('POS: el anticipo pagado se descuenta y no se cobra dos veces', () => {
  function montarPos(pagos: any[]) {
    const creadas: any[] = [];
    const tx: any = { ventaLocal: { create: jest.fn(async ({ data }: any) => { creadas.push(data); return { id: 7, ...data }; }), update: jest.fn(async ({ data }: any) => ({ id: 7, ...creadas[0], ...data })) } };
    const prisma: any = {
      servicio: { findUnique: jest.fn(async () => ({ id: 5, precio: new Prisma.Decimal(900), activo: true })) },
      cita: { findUnique: jest.fn(async () => ({ id: 40, estado: 'completada', servicioId: 5, especialistaId: 'est-1', ventaItem: null })) },
      usuario: { findMany: jest.fn(async () => []) },
      perfilEmpleado: { findMany: jest.fn(async () => []) },
      comisionServicio: { findUnique: jest.fn(async () => null) },
      pago: { findMany: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where))) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { pos: new PosService(prisma, {} as any, { emit: jest.fn() } as any), creadas };
  }
  const anticipoAprobado = { id: 1, citaId: 40, estado: 'aprobado', monto: new Prisma.Decimal(150) };

  it('total = precio - anticipo; la venta guarda el anticipo y la línea conserva el precio', async () => {
    const { pos, creadas } = montarPos([anticipoAprobado, { id: 2, citaId: 40, estado: 'reembolsado', monto: new Prisma.Decimal(150) }]);
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1');
    expect(Number(creadas[0].anticipo)).toBe(150);
    expect(Number(creadas[0].total)).toBe(750);
    expect(Number(creadas[0].items.create[0].precioUnitario)).toBe(900);
  });

  it('en pago mixto la suma es el saldo, no el precio completo', async () => {
    const { pos } = montarPos([anticipoAprobado]);
    await expect(pos.crearVenta({ metodoPago: 'mixto', pagos: { efectivo: 400, tarjeta: 500 }, items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(pos.crearVenta({ metodoPago: 'mixto', pagos: { efectivo: 400, tarjeta: 350 }, items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).resolves.toBeDefined();
  });

  it('descuento más anticipo no puede pasar del subtotal', async () => {
    const { pos } = montarPos([anticipoAprobado]);
    await expect(pos.crearVenta({ metodoPago: 'efectivo', descuento: 800, motivoDescuento: 'x', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una venta sin citas no consulta anticipos', async () => {
    const { pos, creadas } = montarPos([anticipoAprobado]);
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, cantidad: 1 }] } as any, 'caj-1');
    expect(Number(creadas[0].anticipo ?? 0)).toBe(0);
    expect(Number(creadas[0].total)).toBe(900);
  });
});

// ---------- 7. Cancelaciones y reembolsos ----------
describe('Cancelar, reembolsar, retener y no asistió', () => {
  // Reloj fijo como en los demás bloques: reprogramar desde el portal exige una fecha futura.
  beforeEach(() => jest.useFakeTimers({ now: AHORA }));
  afterEach(() => jest.useRealTimers());
  const pagoMpAprobado = () => ({ id: 1, citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555', monto: new Prisma.Decimal(150), metodo: 'mercado_pago' });
  const pagoSalon = () => ({ id: 2, citaId: 7, estado: 'aprobado', proveedor: null, referenciaExterna: null, monto: new Prisma.Decimal(150), metodo: 'efectivo', cobradoPorId: 'estilista-yo' });

  it('si la clienta cancela con anticipo pagado, el anticipo se retiene: sigue aprobado, sin revisión ni aviso', async () => {
    const { citasSrv, pagos, eventos } = citasCon(citaConAnticipo({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), [pagoMpAprobado()]);
    await citasSrv.cancelar(7, { motivoCancelacion: 'No puedo ir' } as any, yo('cliente'), true);
    expect(pagos[0].estado).toBe('aprobado');
    expect(pagos[0].retenidoEn).toBeInstanceOf(Date);
    expect(eventos.emit).not.toHaveBeenCalledWith('pago.requiere_revision', expect.anything());
  });

  it('si cancela el salón, el pago sigue aprobado, sin retener, hasta que el personal reembolse', async () => {
    const { citasSrv, pagos, prisma, eventos } = citasCon(citaConAnticipo({ clienteId: 'otra', estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), [pagoMpAprobado()]);
    await citasSrv.cancelar(7, { motivoCancelacion: 'La estilista se enfermó' } as any, yo('estilista'));
    expect(pagos[0].estado).toBe('aprobado');
    expect(pagos[0].retenidoEn ?? null).toBeNull();
    expect(prisma.pago.updateMany).not.toHaveBeenCalled();
    expect(eventos.emit).not.toHaveBeenCalledWith('pago.requiere_revision', expect.anything());
  });

  it('reembolsar Mercado Pago usa la API de refunds y deja el pago reembolsado; dos veces responde 409', async () => {
    const { anticipos, mp, pagos } = base({ citas: [citaConAnticipo({ estado: 'cancelada', anticipoPagadoEn: minutos(-30) })], pagos: [pagoMpAprobado()] });
    await anticipos.reembolsar(7, 'estilista-yo');
    expect(mp.reembolsarPago).toHaveBeenCalledWith('555', 'reembolso-pago-1');
    expect(pagos[0].estado).toBe('reembolsado');
    await expect(anticipos.reembolsar(7, 'estilista-yo')).rejects.toBeInstanceOf(ConflictException);
    expect(mp.reembolsarPago).toHaveBeenCalledTimes(1);
  });

  it('reembolsar un pago del salón solo lo registra', async () => {
    const { anticipos, mp, pagos } = base({ citas: [citaConAnticipo({ estado: 'cancelada', anticipoPagadoEn: minutos(-30) })], pagos: [pagoSalon()] });
    await anticipos.reembolsar(7, 'estilista-yo');
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
    expect(pagos[0].estado).toBe('reembolsado');
  });

  it('reembolsar un pago del salón lo registra sin Mercado Pago (en efectivo, con su salida de caja)', async () => {
    const { anticipos, mp, pagos, movimientos } = base({ citas: [citaConAnticipo({ estado: 'cancelada', anticipoPagadoEn: minutos(-30) })], pagos: [pagoSalon()] });
    await anticipos.reembolsar(7, 'estilista-yo');
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
    expect(pagos[0].estado).toBe('reembolsado');
    expect(movimientos).toEqual([expect.objectContaining({ concepto: 'reembolso_anticipo', pagoId: 2, registradoPorId: 'estilista-yo' })]);
  });

  it('no se reembolsa el anticipo de una cita vigente que no está en revisión', async () => {
    const { anticipos } = base({ citas: [citaConAnticipo({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) })], pagos: [pagoMpAprobado()] });
    await expect(anticipos.reembolsar(7, 'estilista-yo')).rejects.toBeInstanceOf(ConflictException);
  });

  it('retener: el pago en revisión vuelve a aprobado', async () => {
    const { anticipos, pagos } = base({ citas: [citaConAnticipo({ estado: 'cancelada' })], pagos: [{ ...pagoMpAprobado(), estado: 'en_revision' }] });
    await anticipos.retener(7);
    expect(pagos[0].estado).toBe('aprobado');
    await expect(anticipos.retener(7)).rejects.toBeInstanceOf(ConflictException);
  });

  it('no asistió: la cita queda no_asistio y el anticipo retenido', async () => {
    const { citasSrv, citas, pagos } = citasCon(citaConAnticipo({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), [pagoSalon()]);
    await citasSrv.marcarNoAsistio(7);
    expect(citas[0].estado).toBe('no_asistio');
    expect(pagos[0].estado).toBe('aprobado');
    await expect(citasSrv.marcarNoAsistio(7)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reprogramar conserva el anticipo', async () => {
    const { citasSrv, citas } = citasCon(citaConAnticipo({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), []);
    await citasSrv.reprogramar(7, { fechaHoraInicio: '2026-10-23T16:00:00.000Z', fechaHoraFin: '2026-10-23T17:00:00.000Z' } as any, yo('cliente'), true);
    expect(Number(citas[0].anticipoRequerido)).toBe(150);
    expect(citas[0].anticipoPagadoEn).toEqual(minutos(-30));
  });
});

// ---------- 8. Configuración ----------
describe('Anticipo por servicio', () => {
  function montarServicios() {
    const prisma: any = {
      servicio: {
        findUnique: jest.fn(async () => ({ id: 5, precio: new Prisma.Decimal(900) })),
        update: jest.fn(async ({ data }: any) => ({ id: 5, precio: new Prisma.Decimal(900), ...data })),
      },
    };
    return { servicio: new ServiciosService(prisma), prisma };
  }
  it('guarda el monto; 0 o nulo quita el anticipo; no puede pasar del precio', async () => {
    const { servicio, prisma } = montarServicios();
    await servicio.actualizarAnticipo(5, 150);
    expect(Number(prisma.servicio.update.mock.calls[0][0].data.anticipoMonto)).toBe(150);
    await servicio.actualizarAnticipo(5, 0);
    expect(prisma.servicio.update.mock.calls[1][0].data.anticipoMonto).toBeNull();
    await expect(servicio.actualizarAnticipo(5, 901)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------- Guard por rol (claves de producción) ----------
describe('Quién puede: guard con las claves de producción', () => {
  async function pasa(Controlador: any, metodo: string, rol: string) {
    const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = { getHandler: () => Controlador.prototype[metodo], getClass: () => Controlador, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }) };
    try { return await guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  }
  it.each([
    // [controlador, método, admin, estilista, empleado, becario, cliente]
    [AnticiposCitasController, 'registrarEnSalon', true, true, true, false, false],
    [AnticiposCitasController, 'reembolsar', true, true, false, false, false],
    [AnticiposCitasController, 'retener', true, true, false, false, false],
    [ServiciosController, 'actualizarAnticipo', true, true, false, false, false],
  ] as const)('%p.%s', async (Controlador, metodo, ...esperado) => {
    const r = [];
    for (const rol of ['admin', 'estilista', 'empleado', 'becario', 'cliente']) r.push(await pasa(Controlador, metodo, rol));
    expect(r).toEqual(esperado);
  });
});

// ---------- Revisión final: casos límite ----------
describe('Casos límite de retener, reembolsar y estado', () => {
  const aprobadoSalon = () => ({ id: 1, citaId: 7, estado: 'aprobado', proveedor: null, referenciaExterna: null, monto: new Prisma.Decimal(150), metodo: 'efectivo', cobradoPorId: 'estilista-yo', retenidoEn: null });
  const revisionMp = () => ({ id: 2, citaId: 7, estado: 'en_revision', proveedor: 'mercadopago', referenciaExterna: '777', monto: new Prisma.Decimal(150), metodo: 'mercado_pago', retenidoEn: null });

  it('no se retiene un pago duplicado: ya hay un anticipo aprobado (el POS lo descontaría dos veces)', async () => {
    const { anticipos, pagos } = base({ citas: [citaConAnticipo({ estado: 'cancelada', anticipoPagadoEn: minutos(-60) })], pagos: [aprobadoSalon(), revisionMp()] });
    await expect(anticipos.retener(7)).rejects.toBeInstanceOf(ConflictException);
    expect(pagos[1].estado).toBe('en_revision');
  });

  it('no se retiene el pago en revisión de una cita que sigue vigente (solo se reembolsa)', async () => {
    const { anticipos } = base({ citas: [citaConAnticipo({ estado: 'pendiente' })], pagos: [revisionMp()] });
    await expect(anticipos.retener(7)).rejects.toBeInstanceOf(ConflictException);
  });

  it('retener deja la decisión firme: después ya no se reembolsa', async () => {
    const { anticipos, pagos, mp } = base({ citas: [citaConAnticipo({ estado: 'cancelada' })], pagos: [revisionMp()] });
    await anticipos.retener(7);
    expect(pagos[0].retenidoEn).toBeInstanceOf(Date);
    await expect(anticipos.reembolsar(7, 'estilista-yo')).rejects.toBeInstanceOf(ConflictException);
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
  });

  it('si Mercado Pago ya había reembolsado el pago, se registra en lugar de quedar atorado', async () => {
    const a = base({ citas: [citaConAnticipo({ estado: 'cancelada', anticipoPagadoEn: minutos(-60) })], pagos: [{ ...revisionMp(), estado: 'aprobado' }] });
    a.mp.reembolsarPago.mockRejectedValueOnce(new Error('400'));
    a.mp.obtenerPago.mockResolvedValueOnce({ ...pagoMp({ id: 777 }), status: 'refunded' });
    await a.anticipos.reembolsar(7, 'estilista-yo');
    expect(a.pagos[0].estado).toBe('reembolsado');
    const b = base({ citas: [citaConAnticipo({ estado: 'cancelada', anticipoPagadoEn: minutos(-60) })], pagos: [{ ...revisionMp(), estado: 'aprobado' }] });
    b.mp.reembolsarPago.mockRejectedValueOnce(new Error('503'));
    b.mp.obtenerPago.mockResolvedValueOnce(pagoMp({ id: 777 }));
    await expect(b.anticipos.reembolsar(7, 'estilista-yo')).rejects.toThrow('503');
    expect(b.pagos[0].estado).toBe('aprobado');
  });

  it('el estado da prioridad al anticipo pagado aunque exista un duplicado reembolsado', async () => {
    const { anticipos } = base({ citas: [citaConAnticipo({ estado: 'confirmada', anticipoPagadoEn: minutos(-60) })], pagos: [aprobadoSalon(), { ...revisionMp(), estado: 'reembolsado' }] });
    const r = await anticipos.consultarEstado(7, yo('cliente'), AHORA);
    expect(r.estado).toBe('aprobado');
  });

  it('la clienta cancela justo cuando llega el webhook: el pago aprobado se retiene igual', async () => {
    const b = citasCon(citaConAnticipo({ estado: 'pendiente', anticipoPagadoEn: null }), [{ ...revisionMp(), estado: 'aprobado' }]);
    await b.citasSrv.cancelar(7, { motivoCancelacion: 'Ya no puedo' } as any, yo('cliente'), true);
    expect(b.pagos[0].estado).toBe('aprobado');
    expect(b.pagos[0].retenidoEn).toBeInstanceOf(Date);
    expect(b.eventos.emit).not.toHaveBeenCalledWith('pago.requiere_revision', expect.anything());
  });
});

describe('ANTICIPOS_DESDE también decide si se pide anticipo', () => {
  beforeAll(() => jest.useFakeTimers({ now: AHORA }));
  afterAll(() => jest.useRealTimers());
  it('sin la variable (barrida apagada) el portal no pide anticipo: la cita nunca se liberaría', async () => {
    delete process.env.ANTICIPOS_DESDE;
    const creadas: any[] = [];
    const prisma: any = {
      usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id === 'est-1' ? 'estilista' : 'cliente', activo: true })) },
      servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, duracionMinutos: 60, anticipoMonto: new Prisma.Decimal(150) })) },
      cita: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => { creadas.push(data); return { id: 1, ...data, servicio: { nombre: 'x' } }; }) },
      $executeRaw: jest.fn(async () => 1),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    await new CitasService(prisma, {} as any, CONFIGURACION as any, { emit: jest.fn() } as any).crear({ clienteId: 'x', especialistaId: 'est-1', servicioId: 5, fechaHoraInicio: '2026-10-21T16:00:00.000Z', fechaHoraFin: '2026-10-21T17:00:00.000Z' } as any, yo('cliente'), true);
    expect(creadas[0].anticipoRequerido ?? null).toBeNull();
  });
});

describe('Precio por debajo del anticipo', () => {
  it('no se puede bajar el precio de un servicio por debajo de su anticipo', async () => {
    const prisma: any = { servicio: { findUnique: jest.fn(async () => ({ id: 5, precio: new Prisma.Decimal(900), anticipoMonto: new Prisma.Decimal(150) })), update: jest.fn() } };
    await expect(new ServiciosService(prisma).actualizar(5, { precio: 100 } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.servicio.update).not.toHaveBeenCalled();
  });
});

describe('Estado del anticipo para el personal', () => {
  it('la ruta de estado carga las claves del rol (con ellas el personal consulta citas ajenas)', async () => {
    for (const rol of ['admin', 'estilista', 'empleado', 'becario', 'cliente']) {
      const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
      const req: any = { user: { id: 'u' } };
      const ctx: any = { getHandler: () => (AnticiposCitasController.prototype as any).estado, getClass: () => AnticiposCitasController, switchToHttp: () => ({ getRequest: () => req }) };
      await expect(new PermisosGuard(new Reflector(), prisma).canActivate(ctx)).resolves.toBe(true);
      expect(req.permisosUsuario).toEqual(CLAVES[rol]);
    }
  });
});

// ---------- 9. Pago del anticipo en línea o en el salón: plazos ----------
describe('Anticipo en línea o en el salón: plazos', () => {
  beforeEach(() => { jest.useFakeTimers({ now: AHORA }); process.env.ANTICIPOS_DESDE = '2026-10-01'; });
  afterEach(() => { jest.useRealTimers(); delete process.env.ANTICIPOS_DESDE; });

  const MENSAJE_SIN_TIEMPO_SALON = 'Ya no da tiempo de pagar en el salón. Paga el anticipo en línea.';
  /** Cita de una hora que empieza `m` minutos después de AHORA. */
  const dtoEn = (m: number, extra: Record<string, unknown> = {}) => ({
    clienteId: 'otra', especialistaId: 'est-1', servicioId: 5,
    fechaHoraInicio: minutos(m).toISOString(), fechaHoraFin: minutos(m + 60).toISOString(), ...extra,
  });

  describe('Crear', () => {
    it("'linea' con la cita lejana: vence en 2 horas y no queda en el salón", async () => {
      const { servicio, creadas } = montarCitas(150);
      await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
      expect(Number(creadas[0].anticipoRequerido)).toBe(150);
      expect(creadas[0].anticipoVenceEn).toEqual(minutos(120));
      expect(creadas[0].anticipoEnSalon ?? false).toBe(false);
    });

    it("'linea' con la cita a menos de 2 h 15 min: el plazo topa en 15 min antes del inicio", async () => {
      for (const inicio of [134, 120, 60]) {
        const { servicio, creadas } = montarCitas(150);
        await servicio.crear(dtoEn(inicio, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
        expect(creadas[0].anticipoVenceEn).toEqual(minutos(inicio - 15));
        expect(creadas[0].anticipoEnSalon ?? false).toBe(false);
      }
      // Justo en 2 h 15 min los dos plazos coinciden.
      const { servicio, creadas } = montarCitas(150);
      await servicio.crear(dtoEn(135, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
      expect(creadas[0].anticipoVenceEn).toEqual(minutos(120));
    });

    it.each([24 * 60, 60])('sin pagoAnticipo se comporta como en línea (cita en %i min)', async (inicio) => {
      const sinElegir = montarCitas(150);
      await sinElegir.servicio.crear(dtoEn(inicio) as any, yo('cliente'), true);
      const enLinea = montarCitas(150);
      await enLinea.servicio.crear(dtoEn(inicio, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
      expect(sinElegir.creadas[0].anticipoVenceEn).toEqual(enLinea.creadas[0].anticipoVenceEn);
      expect(sinElegir.creadas[0].anticipoVenceEn).toEqual(minutos(Math.min(120, inicio - 15)));
      expect(sinElegir.creadas[0].anticipoEnSalon ?? false).toBe(false);
    });

    it("'salon': vence 15 min antes del inicio y queda marcada en el salón", async () => {
      const { servicio, creadas } = montarCitas(150);
      await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      expect(Number(creadas[0].anticipoRequerido)).toBe(150);
      expect(creadas[0].anticipoVenceEn).toEqual(minutos(24 * 60 - 15));
      expect(creadas[0].anticipoEnSalon).toBe(true);
    });

    it("'salon' con exactamente 5 min de margen antes del plazo todavía se acepta", async () => {
      const { servicio, creadas } = montarCitas(150);
      await servicio.crear(dtoEn(20, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      expect(creadas[0]).toMatchObject({ anticipoVenceEn: minutos(5), anticipoEnSalon: true });
    });

    it.each([
      ['faltan menos de 5 min para el plazo', 19],
      ['el plazo es justo ahora', 15],
      ['el plazo ya pasó', 10],
      ['la cita ya empezó', -30],
    ])("'salon' cuando %s: 400 con el mensaje y no se crea la cita", async (_caso, inicio) => {
      const { servicio, creadas, prisma } = montarCitas(150);
      const r = servicio.crear(dtoEn(inicio, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      await expect(r).rejects.toBeInstanceOf(BadRequestException);
      await expect(r).rejects.toThrow(MENSAJE_SIN_TIEMPO_SALON);
      expect(prisma.cita.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(creadas).toHaveLength(0);
    });

    it("'salon' se ignora si la cita no pide anticipo (sin margen tampoco falla)", async () => {
      const { servicio, creadas } = montarCitas(null);
      await servicio.crear(dtoEn(10, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      expect(creadas[0].anticipoRequerido ?? null).toBeNull();
      expect(creadas[0].anticipoVenceEn ?? null).toBeNull();
      expect(creadas[0].anticipoEnSalon ?? false).toBe(false);
    });
  });

  describe('Reprogramar', () => {
    const INICIO = new Date('2026-10-22T16:00:00.000Z');
    const NUEVO = { fechaHoraInicio: '2026-10-23T18:00:00.000Z', fechaHoraFin: '2026-10-23T19:00:00.000Z' };
    const PLAZO_NUEVO = new Date('2026-10-23T17:45:00.000Z');
    const PLAZO_VIEJO = new Date(INICIO.getTime() - 15 * 60_000);
    const citaSalon = (extra: Record<string, unknown> = {}) => citaConAnticipo({
      fechaHoraInicio: INICIO, fechaHoraFin: new Date(INICIO.getTime() + 3_600_000),
      anticipoEnSalon: true, anticipoVenceEn: PLAZO_VIEJO, ...extra,
    });
    /** Llamadas a cita.updateMany que mueven el plazo del anticipo. */
    const cambiosDePlazo = (prisma: any) => prisma.cita.updateMany.mock.calls.filter((c: any) => 'anticipoVenceEn' in c[0].data);

    it('en el salón sin pagar: el plazo pasa a 15 min antes del nuevo inicio, dentro de la transacción', async () => {
      const { citasSrv, citas, prisma } = citasCon(citaSalon(), []);
      await citasSrv.reprogramar(7, NUEVO as any, yo('cliente'), true);
      expect(citas[0].anticipoVenceEn).toEqual(PLAZO_NUEVO);
      expect(citas[0]).toMatchObject({ anticipoEnSalon: true, anticipoPagadoEn: null, estado: 'reprogramada' });
      expect(Number(citas[0].anticipoRequerido)).toBe(150);
      expect(cambiosDePlazo(prisma)).toEqual([[{
        where: { id: 7, anticipoEnSalon: true, anticipoPagadoEn: null, anticipoRequerido: { gt: 0 } },
        data: { anticipoVenceEn: PLAZO_NUEVO },
      }]]);
      // En la transacción: después del candado de la especialista y antes de escribir el nuevo horario.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const orden = prisma.cita.updateMany.mock.invocationCallOrder;
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(orden[0]);
      expect(prisma.cita.updateMany.mock.calls[0][0].data).toHaveProperty('anticipoVenceEn');
      expect(prisma.cita.updateMany.mock.calls[1][0].data).toMatchObject({ estado: 'reprogramada' });
    });

    it('en el salón, si se pagó entre la lectura y la escritura, el plazo no se toca (update condicional)', async () => {
      const { citasSrv, citas, prisma } = citasCon(citaSalon(), []);
      prisma.cita.findUnique.mockImplementationOnce(async () => {
        const fila = { ...citas[0], servicio: { duracionMinutos: 60 } };
        citas[0].anticipoPagadoEn = AHORA; // el pago llegó justo después de leer la cita
        return fila;
      });
      await citasSrv.reprogramar(7, NUEVO as any, yo('cliente'), true);
      expect(citas[0].anticipoVenceEn).toEqual(PLAZO_VIEJO);
    });

    it('en línea sin pagar: no cambia el plazo', async () => {
      const { citasSrv, citas, prisma } = citasCon(citaSalon({ anticipoEnSalon: false, anticipoVenceEn: minutos(120) }), []);
      await citasSrv.reprogramar(7, NUEVO as any, yo('cliente'), true);
      expect(citas[0].anticipoVenceEn).toEqual(minutos(120));
      expect(citas[0].estado).toBe('reprogramada');
      expect(cambiosDePlazo(prisma)).toHaveLength(0);
    });

    it('en el salón ya pagada: no cambia el plazo', async () => {
      const { citasSrv, citas, prisma } = citasCon(citaSalon({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), []);
      await citasSrv.reprogramar(7, NUEVO as any, yo('cliente'), true);
      expect(citas[0].anticipoVenceEn).toEqual(PLAZO_VIEJO);
      expect(citas[0].anticipoPagadoEn).toEqual(minutos(-30));
      expect(citas[0].estado).toBe('reprogramada');
      expect(cambiosDePlazo(prisma)).toHaveLength(0);
    });
  });

  describe('Cancelar', () => {
    const aprobado = (extra: Record<string, unknown> = {}) => ({ id: 1, citaId: 7, estado: 'aprobado', proveedor: null, referenciaExterna: null, monto: new Prisma.Decimal(150), metodo: 'efectivo', retenidoEn: null, ...extra });

    it('como clienta con anticipo aprobado: el pago se retiene (sigue aprobado), sin revisión ni aviso', async () => {
      const yaRetenido = minutos(-600);
      const { citasSrv, pagos, prisma, eventos } = citasCon(
        citaConAnticipo({ estado: 'confirmada', anticipoEnSalon: true, anticipoPagadoEn: minutos(-30) }),
        [aprobado(), aprobado({ id: 2, retenidoEn: yaRetenido }), aprobado({ id: 3, estado: 'en_revision' })],
      );
      await citasSrv.cancelar(7, { motivoCancelacion: 'No puedo ir' } as any, yo('cliente'), true);
      expect(prisma.pago.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.pago.updateMany).toHaveBeenCalledWith({ where: { citaId: 7, estado: 'aprobado', retenidoEn: null }, data: { retenidoEn: AHORA } });
      expect(pagos[0]).toMatchObject({ estado: 'aprobado', retenidoEn: AHORA });
      expect(pagos[1]).toMatchObject({ estado: 'aprobado', retenidoEn: yaRetenido }); // ya retenido: no se pisa
      expect(pagos[2]).toMatchObject({ estado: 'en_revision', retenidoEn: null }); // un duplicado en revisión no se toca
      expect(eventos.emit).not.toHaveBeenCalledWith('pago.requiere_revision', expect.anything());
      expect(eventos.emit).toHaveBeenCalledWith('cita.cancelada', expect.objectContaining({ citaId: 7 }));
    });

    it.each([
      ['estilista', 'otra'],
      ['admin', 'otra'],
      ['estilista', 'estilista-yo'], // su propia cita, pero desde /operacion
    ])('como personal (%s, cita de %s): no toca los pagos', async (rol, clienteId) => {
      const { citasSrv, pagos, prisma, eventos, citas } = citasCon(
        citaConAnticipo({ clienteId, estado: 'confirmada', anticipoPagadoEn: minutos(-30) }),
        [aprobado()],
      );
      await citasSrv.cancelar(7, { motivoCancelacion: 'La estilista se enfermó' } as any, yo(rol));
      expect(citas[0].estado).toBe('cancelada');
      expect(prisma.pago.updateMany).not.toHaveBeenCalled();
      expect(pagos[0]).toMatchObject({ estado: 'aprobado', retenidoEn: null });
      expect(eventos.emit).not.toHaveBeenCalledWith('pago.requiere_revision', expect.anything());
    });
  });

  describe('Barrida', () => {
    const MOTIVO_SALON = 'No recibimos tu anticipo 15 minutos antes de tu cita y el horario quedó libre. Tus próximas citas se apartan pagando el anticipo en línea.';
    const MOTIVO_LINEA = 'No recibimos el anticipo a tiempo y el horario quedó libre';

    it('cancela la cita en el salón vencida con el motivo nuevo, respeta la que sigue en plazo y la de línea conserva su mensaje', async () => {
      const b = base({
        citas: [
          citaConAnticipo({ id: 1, anticipoEnSalon: true, anticipoVenceEn: minutos(-1) }), // salón vencida
          citaConAnticipo({ id: 2, anticipoEnSalon: true, anticipoVenceEn: minutos(30) }), // salón aún en plazo
          citaConAnticipo({ id: 3, anticipoEnSalon: false, anticipoVenceEn: minutos(-1) }), // línea vencida
          citaConAnticipo({ id: 4, anticipoVenceEn: minutos(-1) }), // fila sin el campo: como en línea
          citaConAnticipo({ id: 5, anticipoEnSalon: true, anticipoVenceEn: AHORA }), // salón: vence justo ahora
        ],
      });
      const r: any = await new AnticiposBarridaService(b.prisma, b.eventos as any).barrer(AHORA);

      const consulta = b.prisma.cita.findMany.mock.calls[0][0];
      expect(consulta.where).toMatchObject({ anticipoVenceEn: { lte: AHORA }, anticipoPagadoEn: null, anticipoRequerido: { gt: 0 } });
      expect(consulta.select).toMatchObject({ anticipoEnSalon: true, anticipoVenceEn: true });

      expect(r).toEqual({ canceladas: [1, 3, 4, 5], pagadas: [] });
      const cita = (id: number) => b.citas.find((c) => c.id === id);
      expect(cita(1)).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado' });
      expect(cita(2)).toMatchObject({ estado: 'pendiente', anticipoVenceEn: minutos(30) });
      expect(cita(2).motivoCancelacion).toBeUndefined();

      const motivo = (id: number) => b.eventos.emit.mock.calls.find(([nombre, p]: any) => nombre === 'cita.cancelada' && p.citaId === id)?.[1].motivo;
      expect(motivo(1)).toBe(MOTIVO_SALON);
      expect(motivo(5)).toBe(MOTIVO_SALON);
      expect(motivo(3)).toBe(MOTIVO_LINEA);
      expect(motivo(4)).toBe(MOTIVO_LINEA);
      expect(motivo(2)).toBeUndefined();
      expect(b.eventos.emit).toHaveBeenCalledWith('cita.cancelada', { citaId: 1, clienteId: 'cliente-yo', especialistaId: 'est-1', motivo: MOTIVO_SALON });
    });
  });
});

describe('Límites del portal para el anticipo', () => {
  beforeEach(() => { jest.useFakeTimers({ now: AHORA }); process.env.ANTICIPOS_DESDE = '2026-10-01'; });
  afterEach(() => { jest.useRealTimers(); delete process.env.ANTICIPOS_DESDE; });

  const SIN_TIEMPO = 'Ya no da tiempo de pagar el anticipo antes de tu cita.';
  const YA_TIENE_SALON = 'Ya tienes una cita por pagar en el salón. Paga su anticipo o elige pagar en línea.';
  const SOLO_EN_LINEA = 'Para esta cita, el anticipo se paga en línea.';
  const dtoEn = (m: number, extra: Record<string, unknown> = {}) => ({
    clienteId: 'otra', especialistaId: 'est-1', servicioId: 5,
    fechaHoraInicio: minutos(m).toISOString(), fechaHoraFin: minutos(m + 60).toISOString(), ...extra,
  });
  /** La consulta de faltas recientes es la única con OR (no asistió o anticipo en salón sin pagar). */
  const esConsultaDeFaltas = (where: any) => Array.isArray(where?.OR);
  /** Simula las dos consultas: citas por pagar en el salón y faltas recientes. */
  const contar = (prisma: any, { enSalon = 0, faltas = 0 }: { enSalon?: number; faltas?: number }) =>
    prisma.cita.count.mockImplementation(async ({ where }: any) => (esConsultaDeFaltas(where) ? faltas : enSalon));
  /** cita.count de verdad: filtra `citas` con el `where` que manda el servicio (incluido el OR). */
  const contarEn = (prisma: any, citas: any[]) =>
    prisma.cita.count.mockImplementation(async ({ where }: any) => citas.filter((c) => coincide(c, where)).length);

  describe('1. Una sola cita por pagar en el salón', () => {
    it('si ya tiene una, 400 y no se crea; la consulta va en la transacción con candado por clienta', async () => {
      const { servicio, prisma, creadas } = montarCitas(150);
      contar(prisma, { enSalon: 1 });
      const r = servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      await expect(r).rejects.toBeInstanceOf(BadRequestException);
      await expect(r).rejects.toThrow(YA_TIENE_SALON);
      expect(creadas).toHaveLength(0);
      const consulta = prisma.cita.count.mock.calls.find((c: any) => c[0].where.anticipoEnSalon)[0];
      expect(consulta.where).toEqual({
        clienteId: 'cliente-yo', anticipoEnSalon: true, anticipoPagadoEn: null, anticipoRequerido: { gt: 0 },
        estado: { in: ['pendiente', 'confirmada', 'reprogramada'] },
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2); // candado de la especialista y de la clienta
      expect(prisma.$executeRaw.mock.calls[1].slice(1)).toEqual(['cita-cli:cliente-yo']);
    });

    it('sin otra por pagar en el salón, se crea', async () => {
      const { servicio, prisma, creadas } = montarCitas(150);
      contar(prisma, { enSalon: 0 });
      await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      expect(creadas[0]).toMatchObject({ anticipoEnSalon: true });
    });

    it('con una por pagar en el salón, todavía puede agendar otra pagando en línea', async () => {
      const { servicio, prisma, creadas } = montarCitas(150);
      contar(prisma, { enSalon: 1 });
      await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
      expect(creadas[0].anticipoEnSalon ?? false).toBe(false);
    });
  });

  describe('2. Con una falta en los últimos 6 meses (no asistió o anticipo en salón sin pagar), solo en línea', () => {
    const HACE_6_MESES = new Date('2026-04-20T16:00:00.000Z');

    it('400 al elegir el salón; una sola consulta de faltas desde hace 6 meses', async () => {
      const { servicio, prisma, creadas } = montarCitas(150);
      contar(prisma, { faltas: 1 });
      const r = servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
      await expect(r).rejects.toBeInstanceOf(BadRequestException);
      await expect(r).rejects.toThrow(SOLO_EN_LINEA);
      expect(creadas).toHaveLength(0);
      const consultas = prisma.cita.count.mock.calls.filter((c: any) => esConsultaDeFaltas(c[0].where));
      expect(consultas).toHaveLength(1);
      expect(consultas[0][0].where).toEqual({
        clienteId: 'cliente-yo',
        fechaHoraInicio: { gte: HACE_6_MESES },
        OR: [{ estado: 'no_asistio' }, { estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado', anticipoEnSalon: true }],
      });
      // Se rechaza antes de apartar el horario.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('con citas en memoria (cita.count filtra con el where real)', () => {
      /** Cita previa de la clienta; `dias` negativos = hace tantos días. */
      const previa = (id: number, dias: number, extra: Record<string, unknown>) => ({
        id, clienteId: 'cliente-yo', anticipoEnSalon: false, anticipoPagadoEn: null, anticipoRequerido: new Prisma.Decimal(150),
        motivoCancelacion: null, fechaHoraInicio: minutos(dias * 24 * 60), ...extra,
      });
      const NO_ASISTIO = { estado: 'no_asistio' };
      const SALON_SIN_PAGAR = { estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado', anticipoEnSalon: true };

      it.each([
        ['un "no asistió" reciente', previa(1, -30, NO_ASISTIO)],
        ['un "no asistió" en salón ya pagado', previa(1, -30, { ...NO_ASISTIO, anticipoEnSalon: true, anticipoPagadoEn: minutos(-30 * 24 * 60) })],
        ['una cita en salón liberada por no pagar el anticipo', previa(1, -10, SALON_SIN_PAGAR)],
        ['la liberada hoy (15 min antes de su inicio)', previa(1, 0, { ...SALON_SIN_PAGAR, fechaHoraInicio: minutos(10) })],
        ['un "no asistió" justo en el límite de 6 meses', previa(1, 0, { ...NO_ASISTIO, fechaHoraInicio: HACE_6_MESES })],
      ])('cuenta %s: 400 y no se crea', async (_caso, cita) => {
        const { servicio, prisma, creadas } = montarCitas(150);
        contarEn(prisma, [cita]);
        const r = servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
        await expect(r).rejects.toBeInstanceOf(BadRequestException);
        await expect(r).rejects.toThrow(SOLO_EN_LINEA);
        expect(creadas).toHaveLength(0);
        const conteo = prisma.cita.count.mock.results[0].value;
        await expect(conteo).resolves.toBe(1);
      });

      const QUE_NO_CUENTAN: [string, any][] = [
        ['cancelada por la clienta (en salón)', previa(11, -10, { estado: 'cancelada', motivoCancelacion: 'No puedo ir', anticipoEnSalon: true })],
        ['cancelada por el personal (en salón)', previa(12, -10, { estado: 'cancelada', motivoCancelacion: 'La estilista se enfermó', anticipoEnSalon: true })],
        ['cancelada sin motivo (en salón)', previa(13, -10, { estado: 'cancelada', anticipoEnSalon: true })],
        ['liberada por no pagar, pero en línea', previa(14, -10, { ...SALON_SIN_PAGAR, anticipoEnSalon: false })],
        ['liberada por no pagar, en línea (fila sin el campo)', previa(15, -10, { estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado', anticipoEnSalon: undefined })],
        ['"no asistió" de hace más de 6 meses', previa(16, 0, { ...NO_ASISTIO, fechaHoraInicio: new Date(HACE_6_MESES.getTime() - 1) })],
        ['liberada en salón de hace más de 6 meses', previa(17, -200, SALON_SIN_PAGAR)],
        ['"no asistió" de otra clienta', previa(18, -5, { ...NO_ASISTIO, clienteId: 'otra-clienta' })],
        ['liberada en salón de otra clienta', previa(19, -5, { ...SALON_SIN_PAGAR, clienteId: 'otra-clienta' })],
        ['completada en salón', previa(20, -5, { estado: 'completada', anticipoEnSalon: true, anticipoPagadoEn: minutos(-5 * 24 * 60) })],
      ];

      it.each(QUE_NO_CUENTAN)('no cuenta %s: se agenda en el salón', async (_caso, cita) => {
        const { servicio, prisma, creadas } = montarCitas(150);
        contarEn(prisma, [cita]);
        await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
        expect(creadas).toEqual([expect.objectContaining({ clienteId: 'cliente-yo', anticipoEnSalon: true })]);
      });

      it('todas las que no cuentan juntas siguen sin contar; basta una falta reciente para el 400', async () => {
        const todas = QUE_NO_CUENTAN.map(([, c]) => c);
        const a = montarCitas(150);
        contarEn(a.prisma, todas);
        await a.servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true);
        expect(a.creadas).toHaveLength(1);

        const b = montarCitas(150);
        contarEn(b.prisma, [...todas, previa(30, -2, SALON_SIN_PAGAR)]);
        await expect(b.servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true)).rejects.toThrow(SOLO_EN_LINEA);
        expect(b.creadas).toHaveLength(0);
      });

      it('con faltas recientes todavía puede agendar pagando en línea (sin consultar faltas)', async () => {
        const { servicio, prisma, creadas } = montarCitas(150);
        contarEn(prisma, [previa(1, -30, NO_ASISTIO), previa(2, -10, SALON_SIN_PAGAR)]);
        await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
        expect(creadas[0].anticipoEnSalon ?? false).toBe(false);
        expect(prisma.cita.count).not.toHaveBeenCalled();
      });

      it('una cita en salón vigente por pagar no es falta: responde el límite 1, no el 2', async () => {
        const { servicio, prisma, creadas } = montarCitas(150);
        contarEn(prisma, [previa(1, 5, { estado: 'pendiente', anticipoEnSalon: true, anticipoVenceEn: minutos(5 * 24 * 60 - 15) })]);
        await expect(servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'salon' }) as any, yo('cliente'), true)).rejects.toThrow(YA_TIENE_SALON);
        expect(creadas).toHaveLength(0);
      });
    });

    it('en línea sí puede agendar', async () => {
      const { servicio, prisma, creadas } = montarCitas(150);
      contar(prisma, { faltas: 3 });
      await servicio.crear(dtoEn(24 * 60, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
      expect(creadas).toHaveLength(1);
    });
  });

  describe('3. Sin tiempo para pagar el anticipo antes de la cita', () => {
    it.each([
      ['en línea, faltan menos de 5 min para el plazo', 19, 'linea'],
      ['en línea, el plazo ya pasó', 10, 'linea'],
      ['sin elegir (en línea por omisión)', 19, undefined],
    ])('crear %s: 400 y no se crea', async (_caso, inicio, pago) => {
      const { servicio, creadas } = montarCitas(150);
      const r = servicio.crear(dtoEn(inicio as number, pago ? { pagoAnticipo: pago } : {}) as any, yo('cliente'), true);
      await expect(r).rejects.toBeInstanceOf(BadRequestException);
      await expect(r).rejects.toThrow(SIN_TIEMPO);
      expect(creadas).toHaveLength(0);
    });

    it('crear en línea con exactamente 5 min de margen se acepta', async () => {
      const { servicio, creadas } = montarCitas(150);
      await servicio.crear(dtoEn(20, { pagoAnticipo: 'linea' }) as any, yo('cliente'), true);
      expect(creadas[0].anticipoVenceEn).toEqual(minutos(5));
    });

    it('un servicio sin anticipo se agenda aunque falte poco', async () => {
      const { servicio, creadas } = montarCitas(null);
      await servicio.crear(dtoEn(10) as any, yo('cliente'), true);
      expect(creadas).toHaveLength(1);
    });

    const citaEn = (extra: Record<string, unknown> = {}) => citaConAnticipo({
      fechaHoraInicio: minutos(24 * 60), fechaHoraFin: minutos(25 * 60), anticipoVenceEn: minutos(120), ...extra,
    });
    const aMinutos = (m: number) => ({ fechaHoraInicio: minutos(m).toISOString(), fechaHoraFin: minutos(m + 60).toISOString() });

    it.each([
      ['en línea', { anticipoEnSalon: false }],
      ['en el salón', { anticipoEnSalon: true, anticipoVenceEn: minutos(24 * 60 - 15) }],
    ])('reprogramar una cita %s sin pagar a menos del margen: 400 y no se mueve', async (_caso, extra) => {
      const { citasSrv, citas } = citasCon(citaEn(extra), []);
      const r = citasSrv.reprogramar(7, aMinutos(19) as any, yo('cliente'), true);
      await expect(r).rejects.toBeInstanceOf(BadRequestException);
      await expect(r).rejects.toThrow(SIN_TIEMPO);
      expect(citas[0].fechaHoraInicio).toEqual(minutos(24 * 60));
      expect(citas[0].estado).toBe('pendiente');
    });

    it('reprogramar con exactamente 5 min de margen se acepta', async () => {
      const { citasSrv, citas } = citasCon(citaEn({ anticipoEnSalon: true }), []);
      await citasSrv.reprogramar(7, aMinutos(20) as any, yo('cliente'), true);
      expect(citas[0]).toMatchObject({ estado: 'reprogramada', anticipoVenceEn: minutos(5) });
    });

    it('reprogramar una cita con el anticipo pagado no tiene este límite', async () => {
      const { citasSrv, citas } = citasCon(citaEn({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), []);
      await citasSrv.reprogramar(7, aMinutos(10) as any, yo('cliente'), true);
      expect(citas[0].estado).toBe('reprogramada');
    });
  });

  describe('El panel (sin propios) no tiene los límites 1 y 2', () => {
    it('el personal agenda en el salón aunque la clienta tenga una por pagar y faltas', async () => {
      const { servicio, prisma, creadas } = montarCitas(150);
      contar(prisma, { enSalon: 1, faltas: 2 });
      await servicio.crear(dtoEn(24 * 60, { clienteId: 'clienta-1', pedirAnticipo: true, pagoAnticipo: 'salon' }) as any, yo('estilista'));
      expect(creadas[0]).toMatchObject({ clienteId: 'clienta-1', anticipoEnSalon: true, anticipoVenceEn: minutos(24 * 60 - 15) });
      expect(prisma.cita.count).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // solo el candado de la especialista
    });
  });
});

// ---------- Barrida: antes de liberar una cita consulta su pago en Mercado Pago ----------
describe('Barrida: antes de liberar una cita consulta su pago en Mercado Pago', () => {
  beforeEach(() => { jest.useFakeTimers({ now: AHORA }); process.env.ANTICIPOS_DESDE = '2026-10-01'; });
  afterEach(() => { jest.useRealTimers(); delete process.env.ANTICIPOS_DESDE; });

  const MOTIVO_SALON = 'No recibimos tu anticipo 15 minutos antes de tu cita y el horario quedó libre. Tus próximas citas se apartan pagando el anticipo en línea.';
  const MARGEN_MS = 30 * 60_000;

  /** Barrida de punta a punta: AnticiposCitasService real de `base`, con Mercado Pago simulado. */
  function conMp(citas: any[], pagos: any[] = []) {
    const b = base({ citas, pagos });
    return { ...b, barrida: new AnticiposBarridaService(b.prisma, b.eventos as any, b.anticipos) };
  }
  /** Mercado Pago conoce estos pagos (por id de cita); buscarUltimoPago devuelve el resumen y obtenerPago el detalle. */
  function pagosEnMp(mp: any, porCita: Record<number, any>) {
    mp.buscarUltimoPago.mockImplementation(async (ref: string) => {
      const p = porCita[citaDeReferencia(ref) ?? -1];
      return p ? { id: p.id, status: p.status } : null;
    });
    mp.obtenerPago.mockImplementation(async (id: string) => Object.values(porCita).find((p) => String(p.id) === id));
  }
  const pagoDe = (citaId: number, extra: Record<string, unknown> = {}) => pagoMp({ id: 5000 + citaId, external_reference: `cita-${citaId}`, ...extra });
  const avisoDeCancelacion = (eventos: any, id: number) => eventos.emit.mock.calls.find(([n, p]: any) => n === 'cita.cancelada' && p.citaId === id);
  const cita = (citas: any[], id: number) => citas.find((c) => c.id === id);

  it.each([
    ['en el salón', true],
    ['en línea', false],
  ])('cita %s vencida con pago aprobado en Mercado Pago: se aplica el pago y no se cancela', async (_caso, anticipoEnSalon) => {
    const { barrida, mp, citas, pagos, eventos } = conMp([citaConAnticipo({ anticipoEnSalon, anticipoVenceEn: minutos(-1) })]);
    pagosEnMp(mp, { 7: pagoMp() }); // aprobado, 150 MXN, external_reference cita-7

    await expect(barrida.barrer(AHORA)).resolves.toEqual({ canceladas: [], pagadas: [7] });

    expect(mp.buscarUltimoPago).toHaveBeenCalledWith('cita-7');
    expect(mp.obtenerPago).toHaveBeenCalledWith('555');
    expect(citas[0]).toMatchObject({ estado: 'confirmada', anticipoPagadoEn: new Date(pagoMp().date_approved) });
    expect(citas[0].motivoCancelacion).toBeUndefined();
    expect(pagos).toEqual([expect.objectContaining({ citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555' })]);
    expect(eventos.emit).not.toHaveBeenCalledWith('cita.cancelada', expect.anything());
    expect(eventos.emit).not.toHaveBeenCalledWith('pago.requiere_revision', expect.anything());
    expect(eventos.emit).toHaveBeenCalledWith('cita.anticipo_pagado', { citaId: 7, clienteId: 'cliente-yo' });

    // La siguiente pasada ya no la ve (salió del filtro) ni vuelve a consultar.
    await expect(barrida.barrer(minutos(1))).resolves.toEqual({ canceladas: [], pagadas: [] });
    expect(mp.buscarUltimoPago).toHaveBeenCalledTimes(1);
    expect(pagos).toHaveLength(1);
  });

  it('sin pago aprobado sí cancela (sin pago, pendiente o rechazado); en la misma pasada la pagada se respeta', async () => {
    const { barrida, mp, citas, pagos, eventos } = conMp([
      citaConAnticipo({ id: 7, anticipoEnSalon: true, anticipoVenceEn: minutos(-1) }), // aprobado en MP
      citaConAnticipo({ id: 8, anticipoEnSalon: true, anticipoVenceEn: minutos(-1) }), // sin pago en MP
      citaConAnticipo({ id: 9, anticipoVenceEn: minutos(-1) }), // pendiente en MP
      citaConAnticipo({ id: 10, anticipoEnSalon: true, anticipoVenceEn: minutos(-1) }), // rechazado en MP
    ]);
    pagosEnMp(mp, { 7: pagoDe(7), 9: pagoDe(9, { status: 'pending' }), 10: pagoDe(10, { status: 'rejected' }) });

    await expect(barrida.barrer(AHORA)).resolves.toEqual({ canceladas: [8, 9, 10], pagadas: [7] });

    expect(mp.buscarUltimoPago.mock.calls.map((c: any) => c[0])).toEqual(['cita-7', 'cita-8', 'cita-9', 'cita-10']);
    expect(mp.obtenerPago.mock.calls).toEqual([['5007']]); // solo se pide el detalle del aprobado
    expect(cita(citas, 7).estado).toBe('confirmada');
    for (const id of [8, 9, 10]) expect(cita(citas, id)).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado', anticipoPagadoEn: null });
    expect(pagos).toEqual([expect.objectContaining({ citaId: 7, estado: 'aprobado' })]);
    expect(avisoDeCancelacion(eventos, 7)).toBeUndefined();
    expect(avisoDeCancelacion(eventos, 8)?.[1]).toEqual({ citaId: 8, clienteId: 'cliente-yo', especialistaId: 'est-1', motivo: MOTIVO_SALON });
    expect(avisoDeCancelacion(eventos, 9)?.[1].motivo).toBe('No recibimos el anticipo a tiempo y el horario quedó libre');
    expect(avisoDeCancelacion(eventos, 10)?.[1].motivo).toBe(MOTIVO_SALON);
  });

  it.each([
    ['monto distinto', { transaction_amount: 100 }],
    ['otra moneda', { currency_id: 'USD' }],
  ])('aprobado con %s: el pago queda en revisión y la cita se cancela', async (_caso, extra) => {
    const { barrida, mp, citas, pagos, eventos } = conMp([citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })]);
    pagosEnMp(mp, { 7: pagoMp(extra) });

    await expect(barrida.barrer(AHORA)).resolves.toEqual({ canceladas: [7], pagadas: [] });

    expect(citas[0]).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado', anticipoPagadoEn: null });
    expect(pagos).toEqual([expect.objectContaining({ citaId: 7, estado: 'en_revision', referenciaExterna: '555' })]);
    expect(eventos.emit).toHaveBeenCalledWith('pago.requiere_revision', expect.objectContaining({ citaId: 7, referencia: '555', motivo: 'monto_distinto' }));
    expect(avisoDeCancelacion(eventos, 7)?.[1].motivo).toBe(MOTIVO_SALON);
  });

  it('aprobado que ya estaba registrado en revisión (ya_procesado): se cancela sin duplicar el pago', async () => {
    const enRevision = { id: 1, citaId: 7, estado: 'en_revision', proveedor: 'mercadopago', referenciaExterna: '555', monto: new Prisma.Decimal(100) };
    const { barrida, mp, citas, pagos } = conMp([citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })], [enRevision]);
    pagosEnMp(mp, { 7: pagoMp({ transaction_amount: 100 }) });

    await expect(barrida.barrer(AHORA)).resolves.toEqual({ canceladas: [7], pagadas: [] });
    expect(citas[0].estado).toBe('cancelada');
    expect(pagos).toEqual([enRevision]);
  });

  it.each([null, 'revision', 'ya_procesado'] as const)('con el servicio simulado, si aplicarPagoAprobadoDeMp devuelve %p, cancela', async (resultado) => {
    const b = base({ citas: [citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })] });
    const anticipos = { aplicarPagoAprobadoDeMp: jest.fn(async () => resultado) };
    const r = await new AnticiposBarridaService(b.prisma, b.eventos as any, anticipos as any).barrer(AHORA);
    expect(anticipos.aplicarPagoAprobadoDeMp).toHaveBeenCalledWith(7);
    expect(r).toEqual({ canceladas: [7], pagadas: [] });
    expect(b.citas[0]).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado' });
    expect(avisoDeCancelacion(b.eventos, 7)?.[1].motivo).toBe(MOTIVO_SALON);
  });

  it("con el servicio simulado, si devuelve 'pagado' no cancela ni avisa", async () => {
    const b = base({ citas: [citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })] });
    const anticipos = { aplicarPagoAprobadoDeMp: jest.fn(async () => 'pagado' as const) };
    const r = await new AnticiposBarridaService(b.prisma, b.eventos as any, anticipos as any).barrer(AHORA);
    expect(r).toEqual({ canceladas: [], pagadas: [7] });
    expect(b.prisma.cita.updateMany).not.toHaveBeenCalled();
    expect(b.eventos.emit).not.toHaveBeenCalledWith('cita.cancelada', expect.anything());
  });

  it.each([
    ['buscar el último pago', 'buscarUltimoPago'],
    ['obtener el detalle del pago', 'obtenerPago'],
  ])('si Mercado Pago falla al %s dentro del margen, no cancela; la siguiente pasada aplica el pago', async (_caso, falla) => {
    const { barrida, mp, citas, eventos } = conMp([
      citaConAnticipo({ id: 7, anticipoEnSalon: true, anticipoVenceEn: minutos(-1) }),
      citaConAnticipo({ id: 8, anticipoEnSalon: true, anticipoVenceEn: minutos(-1) }), // sin pago: la falla de la 7 no la detiene
    ]);
    pagosEnMp(mp, { 7: pagoMp() });
    (mp as any)[falla].mockRejectedValueOnce(new Error('Mercado Pago 503'));

    await expect(barrida.barrer(AHORA)).resolves.toEqual({ canceladas: [8], pagadas: [] });
    expect(cita(citas, 7)).toMatchObject({ estado: 'pendiente', anticipoPagadoEn: null });
    expect(cita(citas, 7).motivoCancelacion).toBeUndefined();
    expect(avisoDeCancelacion(eventos, 7)).toBeUndefined();

    // 28 min después (29 min tras el vencimiento, aún en el margen) Mercado Pago responde.
    await expect(barrida.barrer(minutos(28))).resolves.toEqual({ canceladas: [], pagadas: [7] });
    expect(cita(citas, 7).estado).toBe('confirmada');
    expect(avisoDeCancelacion(eventos, 7)).toBeUndefined();
  });

  it('si Mercado Pago sigue fallando, se reintenta solo dentro del margen; pasado, cancela sin consultar', async () => {
    const { barrida, mp, citas, eventos } = conMp([citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })]);
    mp.buscarUltimoPago.mockRejectedValue(new Error('Mercado Pago 503'));

    for (const m of [0, 10, 28]) {
      await expect(barrida.barrer(minutos(m))).resolves.toEqual({ canceladas: [], pagadas: [] });
    }
    expect(mp.buscarUltimoPago).toHaveBeenCalledTimes(3);
    expect(citas[0].estado).toBe('pendiente');

    // Justo al cumplirse 30 min del vencimiento: cancela sin volver a consultar.
    await expect(barrida.barrer(minutos(29))).resolves.toEqual({ canceladas: [7], pagadas: [] });
    expect(mp.buscarUltimoPago).toHaveBeenCalledTimes(3);
    expect(citas[0]).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'anticipo_no_pagado' });
    expect(avisoDeCancelacion(eventos, 7)?.[1].motivo).toBe(MOTIVO_SALON);
  });

  it('pasado el margen de 30 min cancela sin consultar Mercado Pago aunque haya pago aprobado; ese pago llega después en revisión', async () => {
    const { barrida, mp, citas, pagos, anticipos } = conMp([
      citaConAnticipo({ id: 7, anticipoEnSalon: true, anticipoVenceEn: new Date(AHORA.getTime() - MARGEN_MS) }), // margen cumplido justo ahora
      citaConAnticipo({ id: 8, anticipoEnSalon: true, anticipoVenceEn: new Date(AHORA.getTime() - MARGEN_MS + 1) }), // le queda 1 ms
      citaConAnticipo({ id: 9, anticipoVenceEn: minutos(-120) }), // muy vencida
    ]);
    pagosEnMp(mp, { 7: pagoDe(7), 8: pagoDe(8), 9: pagoDe(9) });

    await expect(barrida.barrer(AHORA)).resolves.toEqual({ canceladas: [7, 9], pagadas: [8] });
    expect(mp.buscarUltimoPago.mock.calls).toEqual([['cita-8']]);
    expect([cita(citas, 7).estado, cita(citas, 8).estado, cita(citas, 9).estado]).toEqual(['cancelada', 'confirmada', 'cancelada']);

    // El pago tardío de la 7 llega por webhook: queda en revisión, la cita sigue cancelada.
    await expect(anticipos.procesarPagoCita(pagoDe(7) as any, 7)).resolves.toBe('revision');
    expect(cita(citas, 7)).toMatchObject({ estado: 'cancelada', anticipoPagadoEn: null });
    expect(pagos.find((p) => p.citaId === 7)).toMatchObject({ estado: 'en_revision', referenciaExterna: '5007' });
  });

  it('sin AnticiposCitasService (constructor de dos parámetros) cancela sin consultar Mercado Pago', async () => {
    const b = base({ citas: [citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })] });
    pagosEnMp(b.mp, { 7: pagoMp() });
    await expect(new AnticiposBarridaService(b.prisma, b.eventos as any).barrer(AHORA)).resolves.toEqual({ canceladas: [7], pagadas: [] });
    expect(b.mp.buscarUltimoPago).not.toHaveBeenCalled();
    expect(b.citas[0].estado).toBe('cancelada');
  });

  it('si el webhook pagó la cita entre la lectura y la consulta, no se cancela ni se duplica el pago', async () => {
    const { barrida, mp, citas, pagos, prisma, eventos } = conMp([citaConAnticipo({ anticipoEnSalon: true, anticipoVenceEn: minutos(-1) })]);
    pagosEnMp(mp, { 7: pagoMp() });
    prisma.cita.findMany.mockImplementationOnce(async () => {
      const filas = [{ ...citas[0] }];
      // El webhook llega justo después de leer el lote.
      Object.assign(citas[0], { anticipoPagadoEn: minutos(-10), estado: 'confirmada' });
      pagos.push({ id: 1, citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555', monto: new Prisma.Decimal(150) });
      return filas;
    });

    const r: any = await barrida.barrer(AHORA);
    expect(r.canceladas).toEqual([]);
    expect(citas[0]).toMatchObject({ estado: 'confirmada', anticipoPagadoEn: minutos(-10) });
    expect(citas[0].motivoCancelacion).toBeUndefined();
    expect(pagos).toHaveLength(1);
    expect(eventos.emit).not.toHaveBeenCalledWith('cita.cancelada', expect.anything());
  });
});
