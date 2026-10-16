import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CitasService } from './citas.service';
import { establecerReglasNegocio } from '../configuracion-sitio/reglas-negocio';

/**
 * Agendar con las reglas de Configuración del sitio > Reglas: el plazo del anticipo, el límite para pagar en el salón,
 * quién puede pagar en el salón y cuántas citas por pagar puede tener una clienta salen de ahí. Cada cita guarda las
 * reglas con que se creó, así un cambio posterior no la afecta.
 */
const AHORA = new Date('2026-10-20T16:00:00.000Z');
const HORA = 60 * 60_000;
const CONFIGURACION = {
  obtener: async () => ({ data: { entradaLunesViernes: '09:30', salidaLunesViernes: '19:30', entradaSabado: '09:30', salidaSabado: '19:00', entradaDomingo: null, salidaDomingo: null } }),
};
const CLIENTA = { id: 'cli-1', rol: 'cliente', claves: ['citas:propia'] };
const dto = { clienteId: 'cli-1', especialistaId: 'est-1', servicioId: 5, fechaHoraInicio: '2026-10-21T16:00:00.000Z', fechaHoraFin: '2026-10-21T17:00:00.000Z' };

function montar(opciones: { porPagar?: number; faltas?: number } = {}) {
  const creadas: any[] = [];
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id === 'est-1' ? 'estilista' : 'cliente', activo: true })) },
    servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, duracionMinutos: 60, anticipoMonto: new Prisma.Decimal(150) })) },
    cita: {
      findFirst: jest.fn(async () => null),
      count: jest.fn(async ({ where }: any) => (where?.anticipoEnSalon === true && where?.anticipoPagadoEn === null ? opciones.porPagar ?? 0 : opciones.faltas ?? 0)),
      create: jest.fn(async ({ data }: any) => {
        creadas.push(data);
        return { id: 1, ...data, servicio: { nombre: 'Nanoplastia' } };
      }),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return { servicio: new CitasService(prisma, {} as any, CONFIGURACION as any, { emit: jest.fn() } as any), creadas };
}

describe('Agendar con las reglas de negocio', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: AHORA });
    process.env.ANTICIPOS_DESDE = '2026-10-01';
  });
  afterAll(() => {
    jest.useRealTimers();
    delete process.env.ANTICIPOS_DESDE;
  });
  afterEach(() => establecerReglasNegocio(null));

  it('el plazo para pagar en línea sale de la regla (3 horas) y la cita guarda las reglas con que se creó', async () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: 3 } });
    const { servicio, creadas } = montar();
    await servicio.crear(dto as any, CLIENTA as any, true);
    expect(creadas[0].anticipoVenceEn).toEqual(new Date(AHORA.getTime() + 3 * HORA));
    expect(creadas[0].reglas).toMatchObject({ plazoAnticipoHoras: 3, minutosAntesPagoSalon: 15 });
  });

  it('con las reglas de hoy (2 horas) nada cambia', async () => {
    const { servicio, creadas } = montar();
    await servicio.crear(dto as any, CLIENTA as any, true);
    expect(creadas[0].anticipoVenceEn).toEqual(new Date(AHORA.getTime() + 2 * HORA));
  });

  it('pagar en el salón vence los minutos antes que diga la regla (30)', async () => {
    establecerReglasNegocio({ citas: { minutosAntesPagoSalon: 30 } });
    const { servicio, creadas } = montar();
    await servicio.crear({ ...dto, pagoAnticipo: 'salon' } as any, CLIENTA as any, true);
    expect(creadas[0].anticipoVenceEn).toEqual(new Date(new Date(dto.fechaHoraInicio).getTime() - 30 * 60_000));
    expect(creadas[0].anticipoEnSalon).toBe(true);
  });

  it('si el salón no permite pagar el anticipo ahí: 400 en español', async () => {
    establecerReglasNegocio({ citas: { permitirAnticipoEnSalon: false } });
    const { servicio, creadas } = montar();
    const error = await servicio.crear({ ...dto, pagoAnticipo: 'salon' } as any, CLIENTA as any, true).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toMatch(/en línea/);
    expect(creadas).toHaveLength(0);
  });

  it('si el pago en línea de anticipos está apagado: 400 y pide elegir el salón', async () => {
    establecerReglasNegocio({ pagos: { mercadoPagoAnticipos: false } });
    const { servicio, creadas } = montar();
    const error = await servicio.crear({ ...dto, pagoAnticipo: 'linea' } as any, CLIENTA as any, true).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toMatch(/salón/);
    expect(creadas).toHaveLength(0);
  });

  it('el máximo de citas por pagar en el salón sale de la regla (con 2, la segunda sí entra)', async () => {
    establecerReglasNegocio({ citas: { maxCitasPorPagarEnSalon: 2 } });
    const a = montar({ porPagar: 1 });
    await a.servicio.crear({ ...dto, pagoAnticipo: 'salon' } as any, CLIENTA as any, true);
    expect(a.creadas).toHaveLength(1);
    const b = montar({ porPagar: 2 });
    await expect(b.servicio.crear({ ...dto, pagoAnticipo: 'salon' } as any, CLIENTA as any, true)).rejects.toThrow(/por pagar en el salón/);
  });

  it('meses solo en línea después de una falta: con 0 no se revisan las faltas', async () => {
    establecerReglasNegocio({ citas: { noAsistio: { mesesSoloPagoEnLinea: 0 } } });
    const { servicio, creadas } = montar({ faltas: 3 });
    await servicio.crear({ ...dto, pagoAnticipo: 'salon' } as any, CLIENTA as any, true);
    expect(creadas).toHaveLength(1);
  });
});

describe('Horarios disponibles cada los minutos de la regla', () => {
  afterEach(() => establecerReglasNegocio(null));
  it('con 60 minutos, los horarios van de hora en hora', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-20T06:00:00.000Z') });
    establecerReglasNegocio({ citas: { intervaloHorariosMinutos: 60 } });
    const prisma: any = {
      usuario: { findUnique: jest.fn(async () => ({ id: 'est-1', rol: 'estilista', activo: true })) },
      servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, duracionMinutos: 60 })) },
      cita: { findMany: jest.fn(async () => []) },
    };
    const servicio = new CitasService(prisma, {} as any, CONFIGURACION as any, { emit: jest.fn() } as any);
    const r: any = await servicio.disponibilidad({ especialistaId: 'est-1', fecha: '2026-10-21', servicioId: 5 } as any);
    const slots = r.data?.slots ?? r.slots ?? r.data;
    const horas = slots.map((s: any) => s.horaLocal);
    expect(horas.slice(0, 3).map((h: string) => h.slice(0, 5))).toEqual(['09:30', '10:30', '11:30']);
    jest.useRealTimers();
  });
});
