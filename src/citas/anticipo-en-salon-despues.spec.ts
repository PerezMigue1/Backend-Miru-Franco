import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CitasService } from './citas.service';
import type { Solicitante } from '../common/utils/permisos-citas.util';

/**
 * Después de agendar con anticipo en línea, la clienta puede elegir pagarlo en el salón desde la confirmación o el
 * detalle de su cita, con las mismas reglas que al agendar: a más tardar 15 min antes del inicio, sin faltas en los
 * últimos 6 meses y una sola cita por pagar en el salón.
 */
const AHORA = new Date('2026-10-20T15:00:00.000Z');
const CLIENTA: Solicitante = { id: 'cli-1', rol: 'cliente', claves: ['citas:propia'] };

type EnLinea = 'pagado' | 'en_proceso' | 'sin_pago' | 'error';
function montar(extra: Record<string, unknown> = {}, opciones: { faltas?: number; otrasEnSalon?: number; enLinea?: EnLinea } = {}) {
  const cita: Record<string, any> = {
    id: 7,
    clienteId: 'cli-1',
    especialistaId: 'est-1',
    estado: 'pendiente',
    anticipoRequerido: new Prisma.Decimal(150),
    anticipoPagadoEn: null,
    anticipoEnSalon: false,
    anticipoVenceEn: new Date('2026-10-20T17:00:00.000Z'),
    fechaHoraInicio: new Date('2026-10-22T16:00:00.000Z'),
    fechaHoraFin: new Date('2026-10-22T17:00:00.000Z'),
    ...extra,
  };
  const candados: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, clave: string) => candados.push(clave)),
    cita: {
      count: jest.fn(async () => opciones.otrasEnSalon ?? 0),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== cita.id || cita.anticipoPagadoEn !== null || cita.anticipoEnSalon !== false) return { count: 0 };
        Object.assign(cita, data);
        return { count: 1 };
      }),
    },
  };
  const prisma: any = {
    cita: { findUnique: jest.fn(async () => ({ ...cita })), count: jest.fn(async () => opciones.faltas ?? 0) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  // Lo que Mercado Pago dice del anticipo en línea de esta cita (AnticiposCitasService.revisarPagoEnLinea).
  const anticipos = {
    revisarPagoEnLinea: jest.fn(async () => {
      if (opciones.enLinea === 'error') throw new Error('Mercado Pago no responde');
      return opciones.enLinea ?? 'sin_pago';
    }),
  };
  const servicio = new CitasService(prisma, {} as any, { obtener: jest.fn() } as any, { emit: jest.fn() } as any, anticipos as any);
  return { servicio, cita, candados, anticipos };
}

describe('Pagar el anticipo en el salón después de agendar', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    jest.useFakeTimers({ now: AHORA });
    process.env = { ...ENV, MP_ACCESS_TOKEN: 'token-de-prueba-ficticio' };
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...ENV };
  });

  it('antes de cambiar revisa en Mercado Pago el anticipo en línea de la cita', async () => {
    const { servicio, anticipos } = montar();
    await servicio.pagarAnticipoEnSalon(7, CLIENTA);
    expect(anticipos.revisarPagoEnLinea).toHaveBeenCalledWith(7);
  });

  it('si el anticipo ya se pagó en línea (el aviso no había llegado): 409, se aplica el pago y no pasa a pago en el salón', async () => {
    const { servicio, cita } = montar({}, { enLinea: 'pagado' });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toThrow('ya se pagó en línea');
    expect(cita.anticipoEnSalon).toBe(false);
  });

  it('con un pago en línea en proceso: 409 y no cambia (evita pagar dos veces)', async () => {
    const { servicio, cita } = montar({}, { enLinea: 'en_proceso' });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toBeInstanceOf(ConflictException);
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toThrow('en proceso');
    expect(cita.anticipoEnSalon).toBe(false);
  });

  it('si Mercado Pago no responde: 503 y no cambia (no se puede confirmar que no pagó)', async () => {
    const { servicio, cita } = montar({}, { enLinea: 'error' });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(cita.anticipoEnSalon).toBe(false);
  });

  it('sin Mercado Pago configurado no hay pagos en línea que revisar: cambia sin consultar', async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const { servicio, cita, anticipos } = montar({}, { enLinea: 'error' });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).resolves.toMatchObject({ anticipoEnSalon: true });
    expect(anticipos.revisarPagoEnLinea).not.toHaveBeenCalled();
    expect(cita.anticipoEnSalon).toBe(true);
  });

  it('cambia a pago en el salón y el plazo pasa a 15 min antes del inicio, con candado por clienta', async () => {
    const { servicio, cita, candados } = montar();
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).resolves.toMatchObject({ anticipoEnSalon: true });
    expect(cita.anticipoEnSalon).toBe(true);
    expect(cita.anticipoVenceEn.toISOString()).toBe('2026-10-22T15:45:00.000Z');
    expect(candados).toEqual(['cita-cli:cli-1']);
  });

  it('la cita de otra clienta: 404 (no revela que existe)', async () => {
    const { servicio } = montar({ clienteId: 'otra' });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['ya pagada', { anticipoPagadoEn: new Date() }],
    ['ya en el salón', { anticipoEnSalon: true }],
    ['sin anticipo', { anticipoRequerido: null }],
    ['cancelada', { estado: 'cancelada' }],
    ['con el plazo vencido', { anticipoVenceEn: new Date('2026-10-20T14:00:00.000Z') }],
  ])('%s: 409 sin cambiar nada', async (_caso, extra) => {
    const { servicio, cita } = montar(extra);
    const antes = { ...cita };
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toBeInstanceOf(ConflictException);
    expect(cita.anticipoVenceEn).toEqual(antes.anticipoVenceEn);
  });

  it('si ya no da tiempo (menos de 5 min antes del límite del salón): 400 en español', async () => {
    const { servicio } = montar({ fechaHoraInicio: new Date('2026-10-20T15:18:00.000Z'), anticipoVenceEn: new Date('2026-10-20T15:03:00.000Z') });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toThrow('Ya no da tiempo de pagar en el salón');
  });

  it('con faltas en los últimos 6 meses: 400 "el anticipo se paga en línea"', async () => {
    const { servicio, cita } = montar({}, { faltas: 1 });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toThrow('el anticipo se paga en línea');
    expect(cita.anticipoEnSalon).toBe(false);
  });

  it('con otra cita por pagar en el salón: 400 y no cambia', async () => {
    const { servicio, cita } = montar({}, { otrasEnSalon: 1 });
    await expect(servicio.pagarAnticipoEnSalon(7, CLIENTA)).rejects.toThrow('Ya tienes una cita por pagar en el salón');
    expect(cita.anticipoEnSalon).toBe(false);
  });
});

describe('AnticiposCitasService.revisarPagoEnLinea', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AnticiposCitasService } = require('./anticipos/anticipos-citas.service');
  const conPago = (pago: Record<string, unknown> | null) => {
    const mp = { buscarUltimoPago: jest.fn(async () => pago) };
    const s = new AnticiposCitasService({} as any, mp as any, { emit: jest.fn() } as any);
    const aplicar = jest.spyOn(s, 'aplicarPagoAprobadoDeMp').mockResolvedValue('pagado');
    return { s, aplicar };
  };

  it('aprobado: lo aplica con la lógica idempotente del webhook y responde "pagado"', async () => {
    const { s, aplicar } = conPago({ id: 5, status: 'approved' });
    await expect(s.revisarPagoEnLinea(7)).resolves.toBe('pagado');
    expect(aplicar).toHaveBeenCalledWith(7, { id: 5, status: 'approved' });
  });

  it.each(['pending', 'in_process', 'authorized'])('%s: "en_proceso" sin aplicar nada', async (status) => {
    const { s, aplicar } = conPago({ id: 5, status });
    await expect(s.revisarPagoEnLinea(7)).resolves.toBe('en_proceso');
    expect(aplicar).not.toHaveBeenCalled();
  });

  it.each([['rechazado', { id: 5, status: 'rejected' }], ['sin intento', null]])('%s: "sin_pago"', async (_c, pago) => {
    const { s } = conPago(pago as any);
    await expect(s.revisarPagoEnLinea(7)).resolves.toBe('sin_pago');
  });
});

describe('Cableado del anticipo en el salón', () => {
  it('CitasModule importa AnticiposModule para revisar el pago en línea', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CitasModule } = require('./citas.module');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnticiposModule } = require('./anticipos/anticipos.module');
    expect(Reflect.getMetadata('imports', CitasModule)).toContain(AnticiposModule);
  });
});

describe('Ruta PATCH /api/citas/:id/anticipo-en-salon', () => {
  it('existe en el controlador de citas, con los permisos del portal, y llama al servicio con la clienta', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CitasController } = require('./citas.controller');
    const metodo = CitasController.prototype.pagarAnticipoEnSalon;
    expect(Reflect.getMetadata('path', metodo)).toBe(':id/anticipo-en-salon');
    expect(Reflect.getMetadata('permisos', metodo)).toEqual(expect.arrayContaining(['citas:propia', 'citas:propias']));
    const servicio = { pagarAnticipoEnSalon: jest.fn(async () => ({ success: true })) };
    const controlador = new CitasController(servicio as any);
    await controlador.pagarAnticipoEnSalon(7, { user: { id: 'cli-1' }, rolUsuario: 'cliente', permisosUsuario: ['citas:propia'] });
    expect(servicio.pagarAnticipoEnSalon).toHaveBeenCalledWith(7, expect.objectContaining({ id: 'cli-1', rol: 'cliente' }));
  });
});
