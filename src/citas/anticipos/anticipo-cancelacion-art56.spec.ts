import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { MercadoPagoClient } from '../../ecommerce/mercadopago/mercadopago.client';
import { PrismaService } from '../../prisma/prisma.service';
import { CitasService } from '../citas.service';
import { AnticiposCitasService } from './anticipos-citas.service';
import { EVENTO_ANTICIPO_REEMBOLSABLE, politicaCancelacionAnticipo } from './anticipos.util';

/**
 * Política de anticipos compatible con el art. 56 de la Ley Federal de Protección al Consumidor (la más
 * favorable a la clienta, autorizada por el dueño): si la cita está a MÁS de 10 días hábiles del pago del
 * anticipo, la clienta puede cancelar dentro de los 5 días hábiles siguientes al pago y se le devuelve completo;
 * en cualquier otro caso se retiene (puede reagendar con aviso). Si cancela el salón, sin cambios: se devuelve.
 *
 * Calendario (octubre de 2026, sin festivos): pago el miércoles 14.
 *   jue 15 (1), vie 16 (2), sáb 17 (3), dom 18 no, lun 19 (4), mar 20 (5) -> cancela con reembolso hasta el
 *   martes 20 a las 23:59:59.999 de México; mié 21 (6), jue 22 (7), vie 23 (8), sáb 24 (9), dom 25 no,
 *   lun 26 (10), mar 27 (11).
 */
const PAGO = new Date('2026-10-14T12:00:00-06:00');
const CITA_11_DIAS = new Date('2026-10-27T11:00:00-06:00');
const CITA_10_DIAS = new Date('2026-10-26T11:00:00-06:00');
const LIMITE = new Date('2026-10-20T23:59:59.999-06:00');
const yo = (rol: string) => ({ id: `${rol}-yo`, rol, claves: rol === 'cliente' ? ['citas:propia'] : ['citas:escritura', 'caja:escritura'] });

describe('Regla: anticipo reembolsable al cancelar', () => {
  it('más de 10 días hábiles entre el pago y la cita, y dentro de los 5 siguientes al pago: se devuelve', () => {
    expect(politicaCancelacionAnticipo(PAGO, CITA_11_DIAS, new Date('2026-10-20T23:00:00-06:00'))).toEqual({
      reembolsable: true,
      reembolsableHasta: LIMITE,
      diasHabilesHastaCita: 11,
    });
    expect(politicaCancelacionAnticipo(PAGO, CITA_11_DIAS, LIMITE)?.reembolsable).toBe(true);
  });

  it('pasados los 5 días hábiles del pago: ya no se devuelve', () => {
    expect(politicaCancelacionAnticipo(PAGO, CITA_11_DIAS, new Date('2026-10-21T00:00:00-06:00'))).toEqual({
      reembolsable: false,
      reembolsableHasta: LIMITE,
      diasHabilesHastaCita: 11,
    });
  });

  it('a 10 días hábiles o menos del pago: no se devuelve, aunque cancele el mismo día', () => {
    expect(politicaCancelacionAnticipo(PAGO, CITA_10_DIAS, PAGO)).toEqual({ reembolsable: false, reembolsableHasta: null, diasHabilesHastaCita: 10 });
  });

  it('sin fecha de pago o de cita: null (se retiene como hoy)', () => {
    expect(politicaCancelacionAnticipo(null, CITA_11_DIAS, PAGO)).toBeNull();
    expect(politicaCancelacionAnticipo(PAGO, undefined, PAGO)).toBeNull();
  });
});

// ---------- Prisma en memoria (citas y pagos) ----------
function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => coincide(fila, w));
    if (v === null) return fila[k] == null;
    if (v && typeof v === 'object' && !(v instanceof Date) && 'in' in v) return v.in.includes(fila[k]);
    return fila[k] === v;
  });
}

function montar(opts: { cita?: Record<string, unknown>; pagos: any[] }) {
  const citas: any[] = [{
    id: 7, clienteId: 'cliente-yo', especialistaId: 'est-1', servicioId: 5, estado: 'confirmada', creadoEn: PAGO,
    anticipoRequerido: new Prisma.Decimal(150), anticipoPagadoEn: PAGO, anticipoVenceEn: PAGO, fechaHoraInicio: CITA_11_DIAS, ...opts.cita,
  }];
  const pagos = opts.pagos;
  const movimientos: any[] = [];
  const conRelaciones = (c: any) => c && { ...c, servicio: { id: 5, nombre: 'Nanoplastia', precio: new Prisma.Decimal(900), duracionMinutos: 60 }, pagos: pagos.filter((p) => p.citaId === c.id) };
  const prisma: any = {
    cita: {
      findUnique: jest.fn(async ({ where }: any) => conRelaciones(citas.find((c) => c.id === where.id))),
      update: jest.fn(async ({ where, data }: any) => { const c = citas.find((x) => x.id === where.id); Object.assign(c, data); return conRelaciones(c); }),
    },
    pago: {
      findMany: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where))),
      findFirst: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where)).sort((a, b) => b.id - a.id)[0] ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => { const r = pagos.filter((p) => coincide(p, where)); r.forEach((p) => Object.assign(p, data)); return { count: r.length }; }),
    },
    movimientoCaja: { create: jest.fn(async ({ data }: any) => { movimientos.push(data); return data; }) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const mp = { reembolsarPago: jest.fn(async () => ({ id: 77, status: 'approved' })), obtenerPago: jest.fn(), buscarUltimoPago: jest.fn(async () => null) };
  // Eventos que emite AnticiposCitasService (p. ej. el aviso de anticipo por devolver).
  const eventosAnticipos = { emit: jest.fn() };
  const anticipos = new AnticiposCitasService(prisma, mp as any, eventosAnticipos as any);
  // El evento se entrega al listener de anticipos, como EventEmitterModule en producción.
  const eventos = {
    emit: jest.fn((nombre: string, payload: any) => {
      if (nombre === 'cita.anticipo_reembolsable') void anticipos.alCancelarConReembolso(payload);
      return true;
    }),
  };
  const citasSrv = new CitasService(prisma, {} as any, {} as any, eventos as any);
  return { citasSrv, anticipos, citas, pagos, movimientos, mp, eventos, eventosAnticipos, prisma };
}

const pagoMp = (extra: Record<string, unknown> = {}) => ({ id: 1, citaId: 7, estado: 'aprobado', proveedor: 'mercadopago', referenciaExterna: '555', monto: new Prisma.Decimal(150), metodo: 'mercado_pago', cobradoPorId: null, pagadoEn: PAGO, retenidoEn: null, ...extra });
const pagoSalon = (extra: Record<string, unknown> = {}) => ({ id: 2, citaId: 7, estado: 'aprobado', proveedor: null, referenciaExterna: null, monto: new Prisma.Decimal(150), metodo: 'efectivo', cobradoPorId: 'estilista-yo', pagadoEn: PAGO, retenidoEn: null, ...extra });
const cancelarComoClienta = (s: CitasService) => s.cancelar(7, { motivoCancelacion: 'Ya no puedo' } as any, yo('cliente'), true);
const esperarListener = () => new Promise((r) => setImmediate(r));

describe('La clienta cancela una cita con anticipo pagado', () => {
  afterEach(() => jest.useRealTimers());

  it('reembolsable y pagado con Mercado Pago: no se retiene y se reembolsa solo con el cliente existente', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-19T18:00:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos, mp, eventos, eventosAnticipos, citas } = montar({ pagos: [pagoMp()] });

    await cancelarComoClienta(citasSrv);
    await esperarListener();

    expect(citas[0].estado).toBe('cancelada');
    expect(eventos.emit).toHaveBeenCalledWith('cita.anticipo_reembolsable', { citaId: 7, solicitanteId: 'cliente-yo' });
    expect(mp.reembolsarPago).toHaveBeenCalledWith('555', 'reembolso-pago-1');
    expect(pagos[0]).toMatchObject({ estado: 'reembolsado', retenidoEn: null });
    expect(pagos[0].reembolsadoEn).toBeInstanceOf(Date);
    // Ya se devolvió solo: no hay nada que avisar al personal.
    expect(eventosAnticipos.emit).not.toHaveBeenCalledWith('cita.anticipo_por_devolver', expect.anything());
  });

  it('reembolsable y pagado en el salón: no se retiene y queda para que el personal lo reembolse, como cuando cancela el salón', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-20T23:30:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos, mp, movimientos, eventosAnticipos } = montar({ pagos: [pagoSalon()] });

    await cancelarComoClienta(citasSrv);
    await esperarListener();

    expect(pagos[0]).toMatchObject({ estado: 'aprobado', retenidoEn: null });
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
    // Ninguna salida de caja a nombre de la clienta: la entrega el personal al reembolsar.
    expect(movimientos).toHaveLength(0);
    // Se avisa a quien maneja la caja que hay que devolverlo.
    expect(eventosAnticipos.emit).toHaveBeenCalledWith('cita.anticipo_por_devolver', { citaId: 7, motivo: 'pagado_en_salon' });
  });

  it('si Mercado Pago falla, el anticipo tampoco se retiene: queda aprobado para que el personal lo reembolse', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-19T18:00:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos, mp, eventosAnticipos } = montar({ pagos: [pagoMp()] });
    mp.reembolsarPago.mockRejectedValueOnce(new Error('503'));
    mp.obtenerPago.mockResolvedValueOnce({ id: 555, status: 'approved' });

    await cancelarComoClienta(citasSrv);
    await esperarListener();

    expect(pagos[0]).toMatchObject({ estado: 'aprobado', retenidoEn: null });
    expect(eventosAnticipos.emit).toHaveBeenCalledWith('cita.anticipo_por_devolver', { citaId: 7, motivo: 'reembolso_automatico_fallo' });
  });

  it('si el anticipo ya no está por reembolsar (otra petición lo resolvió: 409), no se avisa', async () => {
    const { anticipos, eventosAnticipos } = montar({ cita: { estado: 'cancelada' }, pagos: [pagoMp({ estado: 'reembolsado' })] });
    await anticipos.alCancelarConReembolso({ citaId: 7, solicitanteId: 'cliente-yo' });
    expect(eventosAnticipos.emit).not.toHaveBeenCalledWith('cita.anticipo_por_devolver', expect.anything());
  });

  it('a 10 días hábiles o menos del pago: se retiene como hoy, sin reembolso', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-15T10:00:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos, mp, eventos } = montar({ cita: { fechaHoraInicio: CITA_10_DIAS }, pagos: [pagoMp()] });

    await cancelarComoClienta(citasSrv);
    await esperarListener();

    expect(pagos[0].estado).toBe('aprobado');
    expect(pagos[0].retenidoEn).toBeInstanceOf(Date);
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
    expect(eventos.emit).not.toHaveBeenCalledWith('cita.anticipo_reembolsable', expect.anything());
  });

  it('más de 10 días hábiles pero fuera de los 5 siguientes al pago: se retiene', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-21T00:00:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos, mp } = montar({ pagos: [pagoMp()] });

    await cancelarComoClienta(citasSrv);
    await esperarListener();

    expect(pagos[0].retenidoEn).toBeInstanceOf(Date);
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
  });

  it('la fecha de pago sale del pago aprobado; si no la tiene, de la cita', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-19T18:00:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos } = montar({ pagos: [pagoMp({ pagadoEn: null })] });

    await cancelarComoClienta(citasSrv);
    await esperarListener();

    expect(pagos[0].retenidoEn).toBeNull();
  });
});

describe('El manejador escucha el evento en el contenedor real de Nest', () => {
  it('EventEmitterModule entrega cita.anticipo_reembolsable a AnticiposCitasService y el anticipo de Mercado Pago se reembolsa', async () => {
    // Lo que deja CitasService.cancelar antes de emitir el evento: la cita cancelada y el anticipo sin retener.
    const { prisma, mp, pagos } = montar({ cita: { estado: 'cancelada' }, pagos: [pagoMp()] });
    const modulo = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [AnticiposCitasService, { provide: PrismaService, useValue: prisma }, { provide: MercadoPagoClient, useValue: mp }],
    }).compile();
    await modulo.init();
    try {
      const espia = jest.spyOn(modulo.get(AnticiposCitasService), 'reembolsar');

      await modulo.get(EventEmitter2).emitAsync(EVENTO_ANTICIPO_REEMBOLSABLE, { citaId: 7, solicitanteId: 'cliente-yo' });

      expect(espia).toHaveBeenCalledWith(7, 'cliente-yo', expect.objectContaining({ soloMercadoPago: true }));
      expect(mp.reembolsarPago).toHaveBeenCalledWith('555', 'reembolso-pago-1');
      expect(pagos[0].estado).toBe('reembolsado');
    } finally {
      await modulo.close();
    }
  });
});

describe('Si cancela el salón: sin cambios', () => {
  afterEach(() => jest.useRealTimers());

  it('no se retiene ni se reembolsa solo: el personal lo reembolsa', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-19T18:00:00-06:00'), doNotFake: ['setImmediate'] });
    const { citasSrv, pagos, mp, eventos, prisma } = montar({ cita: { clienteId: 'otra' }, pagos: [pagoMp()] });

    await citasSrv.cancelar(7, { motivoCancelacion: 'La estilista se enfermó' } as any, yo('estilista'));
    await esperarListener();

    expect(prisma.pago.updateMany).not.toHaveBeenCalled();
    expect(pagos[0]).toMatchObject({ estado: 'aprobado', retenidoEn: null });
    expect(mp.reembolsarPago).not.toHaveBeenCalled();
    expect(eventos.emit).not.toHaveBeenCalledWith('cita.anticipo_reembolsable', expect.anything());
  });
});

describe('El estado del anticipo dice qué pasa si la clienta cancela', () => {
  it('pagado y vigente: reembolsable con su fecha límite y los días hábiles hasta la cita', async () => {
    const { anticipos } = montar({ pagos: [pagoMp()] });
    const r = await anticipos.consultarEstado(7, yo('cliente'), new Date('2026-10-19T18:00:00-06:00'));
    expect(r).toMatchObject({ estado: 'aprobado', cancelacion: { reembolsable: true, reembolsableHasta: LIMITE, diasHabilesHastaCita: 11 } });
  });

  it('a 10 días hábiles o menos: no reembolsable', async () => {
    const { anticipos } = montar({ cita: { fechaHoraInicio: CITA_10_DIAS }, pagos: [pagoMp()] });
    const r = await anticipos.consultarEstado(7, yo('cliente'), PAGO);
    expect(r.cancelacion).toEqual({ reembolsable: false, reembolsableHasta: null, diasHabilesHastaCita: 10 });
  });

  it('sin anticipo pagado o con la cita ya cancelada: null', async () => {
    const sinPagar = montar({ cita: { anticipoPagadoEn: null, estado: 'pendiente', anticipoVenceEn: new Date('2030-01-01T00:00:00Z') }, pagos: [] });
    expect((await sinPagar.anticipos.consultarEstado(7, yo('cliente'), PAGO)).cancelacion).toBeNull();
    const cancelada = montar({ cita: { estado: 'cancelada' }, pagos: [pagoMp()] });
    expect((await cancelada.anticipos.consultarEstado(7, yo('cliente'), PAGO)).cancelacion).toBeNull();
  });
});
