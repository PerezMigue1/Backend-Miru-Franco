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
  const conRelaciones = (c: any) => c && { ...c, servicio: { id: c.servicioId, nombre: 'Nanoplastia', precio: new Prisma.Decimal(900) }, pagos: pagos.filter((p) => p.citaId === c.id) };
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

// ---------- 1. Agendar ----------
describe('Agendar: el anticipo sale del servicio y aparta el horario 2 horas', () => {
  beforeAll(() => { jest.useFakeTimers({ now: AHORA }); process.env.ANTICIPOS_DESDE = '2026-10-01'; });
  afterAll(() => { jest.useRealTimers(); delete process.env.ANTICIPOS_DESDE; });

  function montarCitas(anticipoMonto: number | null) {
    const creadas: any[] = [];
    const prisma: any = {
      usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id === 'est-1' ? 'estilista' : 'cliente', activo: true })) },
      servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, anticipoMonto: anticipoMonto === null ? null : new Prisma.Decimal(anticipoMonto) })) },
      cita: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => { creadas.push(data); return { id: 1, ...data, servicio: { nombre: 'Nanoplastia' } }; }) },
      $executeRaw: jest.fn(async () => 1),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    return { servicio: new CitasService(prisma, {} as any, {} as any, { emit: jest.fn() } as any), creadas };
  }
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
  function citasCon(cita: any, pagos: any[]) {
    const b = base({ citas: [cita], pagos });
    b.prisma.cita.findFirst = jest.fn(async () => null);
    b.prisma.$executeRaw = jest.fn(async () => 1);
    const citasSrv = new CitasService(b.prisma, {} as any, {} as any, b.eventos as any);
    return { ...b, citasSrv };
  }
  const pagoMpAprobado = () => ({ id: 1, citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555', monto: new Prisma.Decimal(150), metodo: 'mercado_pago' });
  const pagoSalon = () => ({ id: 2, citaId: 7, estado: 'aprobado', proveedor: null, referenciaExterna: null, monto: new Prisma.Decimal(150), metodo: 'efectivo', cobradoPorId: 'estilista-yo' });

  it('si la clienta cancela con anticipo pagado, el pago queda en revisión y se avisa al personal', async () => {
    const { citasSrv, pagos, eventos } = citasCon(citaConAnticipo({ estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), [pagoMpAprobado()]);
    await citasSrv.cancelar(7, { motivoCancelacion: 'No puedo ir' } as any, yo('cliente'), true);
    expect(pagos[0].estado).toBe('en_revision');
    expect(eventos.emit).toHaveBeenCalledWith('pago.requiere_revision', expect.objectContaining({ citaId: 7, motivo: 'cita_cancelada_por_clienta' }));
  });

  it('si cancela el salón, el pago sigue aprobado hasta que el personal reembolse', async () => {
    const { citasSrv, pagos } = citasCon(citaConAnticipo({ clienteId: 'otra', estado: 'confirmada', anticipoPagadoEn: minutos(-30) }), [pagoMpAprobado()]);
    await citasSrv.cancelar(7, { motivoCancelacion: 'La estilista se enfermó' } as any, yo('estilista'));
    expect(pagos[0].estado).toBe('aprobado');
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
    await citasSrv.reprogramar(7, { fechaHoraInicio: '2026-10-25T16:00:00.000Z', fechaHoraFin: '2026-10-25T17:00:00.000Z' } as any, yo('cliente'), true);
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

  it('la clienta cancela justo cuando llega el webhook: el pago aprobado pasa a revisión igual', async () => {
    const b = base({ citas: [citaConAnticipo({ estado: 'pendiente', anticipoPagadoEn: null })], pagos: [{ ...revisionMp(), estado: 'aprobado' }] });
    b.prisma.cita.findFirst = jest.fn(async () => null);
    b.prisma.$executeRaw = jest.fn(async () => 1);
    const citasSrv = new CitasService(b.prisma, {} as any, {} as any, b.eventos as any);
    await citasSrv.cancelar(7, { motivoCancelacion: 'Ya no puedo' } as any, yo('cliente'), true);
    expect(b.pagos[0].estado).toBe('en_revision');
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
      servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, anticipoMonto: new Prisma.Decimal(150) })) },
      cita: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => { creadas.push(data); return { id: 1, ...data, servicio: { nombre: 'x' } }; }) },
      $executeRaw: jest.fn(async () => 1),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    await new CitasService(prisma, {} as any, {} as any, { emit: jest.fn() } as any).crear({ clienteId: 'x', especialistaId: 'est-1', servicioId: 5, fechaHoraInicio: '2026-10-21T16:00:00.000Z', fechaHoraFin: '2026-10-21T17:00:00.000Z' } as any, yo('cliente'), true);
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
