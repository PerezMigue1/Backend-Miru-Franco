import { BadRequestException, ConflictException } from '@nestjs/common';
import { CitasService } from './citas.service';
import type { Solicitante } from '../common/utils/permisos-citas.util';

/**
 * Una cita reprogramada ocupa su horario nuevo igual que una cita nueva: nadie puede encimarse con
 * ella, la disponibilidad la descuenta y dos movimientos al mismo horario nunca pasan los dos.
 */
const ADMIN: Solicitante = { id: 'adm-1', rol: 'admin', claves: ['*'] };
const DIA = '2027-03-10'; // miércoles
const hora = (hh: string) => new Date(`${DIA}T${hh}:00.000-06:00`);

type CitaMem = Record<string, any> & { id: number; especialistaId: string; estado: string; fechaHoraInicio: Date; fechaHoraFin: Date };

/** Filtro "where" genérico de Prisma en memoria (in, not, lt, gt, lte, gte, OR). */
function coincide(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return (cond as any[]).some((w) => coincide(fila, w));
    const v = fila[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond !== 'object') return v === cond;
    const n = (z: any) => (z instanceof Date ? z.getTime() : z);
    return Object.entries(cond).every(([op, x]: [string, any]) => {
      switch (op) {
        case 'in': return (x as any[]).includes(v);
        case 'not': return x === null ? v !== null && v !== undefined : v !== x;
        case 'lt': return v != null && n(v) < n(x);
        case 'gt': return v != null && n(v) > n(x);
        case 'lte': return v != null && n(v) <= n(x);
        case 'gte': return v != null && n(v) >= n(x);
        case 'is': return x === null ? v == null : coincide(v ?? {}, x);
        default: throw new Error(`Operador no soportado en la prueba: ${op}`);
      }
    });
  });
}

/** Cede el turno para que dos operaciones simultáneas se intercalen como en la base real. */
const ceder = () => new Promise((r) => setImmediate(r));

function montar(iniciales: Partial<CitaMem>[] = []) {
  const citas: CitaMem[] = iniciales.map((c, i) => ({
    id: i + 1, clienteId: 'cli-1', especialistaId: 'est-1', servicioId: 5, estado: 'pendiente', notas: null,
    fechaHoraInicio: hora('10:00'), fechaHoraFin: hora('11:00'), horaCheckOut: null, ventaItem: null, ...c,
  }) as CitaMem);
  const conRelaciones = (c: CitaMem) => ({ ...c, servicio: { nombre: 'Corte' } });
  /** Candados por clave como pg_advisory_xact_lock: se sueltan al terminar la transacción. */
  const candados = new Map<string, Promise<void>>();
  const clavesBloqueadas: string[] = [];

  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id.startsWith('cli') ? 'cliente' : 'estilista', activo: true })) },
    servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true, duracionMinutos: 60, anticipoMonto: null })) },
    cita: {
      findUnique: jest.fn(async ({ where }: any) => { await ceder(); const c = citas.find((x) => x.id === where.id); return c ? conRelaciones(c) : null; }),
      findFirst: jest.fn(async ({ where }: any) => { await ceder(); return citas.find((c) => coincide(c, where)) ?? null; }),
      findMany: jest.fn(async ({ where }: any) => { await ceder(); return citas.filter((c) => coincide(c, where)).map(conRelaciones); }),
      create: jest.fn(async ({ data }: any) => { await ceder(); const c = { id: citas.length + 1, estado: 'pendiente', ...data }; citas.push(c); return conRelaciones(c); }),
      update: jest.fn(async ({ where, data }: any) => { await ceder(); const c = citas.find((x) => x.id === where.id)!; Object.assign(c, data); return conRelaciones(c); }),
      updateMany: jest.fn(async ({ where, data }: any) => { await ceder(); const r = citas.filter((c) => coincide(c, where)); r.forEach((c) => Object.assign(c, data)); return { count: r.length }; }),
    },
  };
  prisma.$transaction = jest.fn(async (arg: any) => {
    if (typeof arg !== 'function') return Promise.all(arg);
    const soltar: (() => void)[] = [];
    const tx = {
      ...prisma,
      $executeRaw: jest.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        if (!partes.join('?').includes('pg_advisory_xact_lock')) throw new Error('Consulta cruda inesperada');
        const clave = valores.map(String).join('|');
        clavesBloqueadas.push(clave);
        const previo = candados.get(clave) ?? Promise.resolve();
        let liberar!: () => void;
        const propio = new Promise<void>((r) => (liberar = r));
        candados.set(clave, previo.then(() => propio));
        soltar.push(liberar);
        await previo;
        return 1;
      }),
    };
    try {
      return await arg(tx);
    } finally {
      soltar.forEach((f) => f());
    }
  });
  const config = {
    obtener: jest.fn(async () => ({
      data: { entradaLunesViernes: '09:00', salidaLunesViernes: '19:00', entradaSabado: '09:00', salidaSabado: '19:00', entradaDomingo: null, salidaDomingo: null },
    })),
  };
  const eventos = { emit: jest.fn() };
  const servicio = new CitasService(prisma, {} as any, config as any, eventos as any);
  return { servicio, prisma, citas, eventos, clavesBloqueadas };
}

const mover = (inicio: string, fin: string) => ({ fechaHoraInicio: hora(inicio).toISOString(), fechaHoraFin: hora(fin).toISOString() }) as any;

describe('Reprogramar valida el horario nuevo igual que una cita nueva', () => {
  it.each(['pendiente', 'confirmada', 'reprogramada', 'en_curso'])('encima de una cita %s de la misma especialista responde 400', async (estado) => {
    const { servicio, citas } = montar([
      { estado: 'pendiente', fechaHoraInicio: hora('10:00'), fechaHoraFin: hora('11:00') },
      { estado, fechaHoraInicio: hora('12:00'), fechaHoraFin: hora('13:00') },
    ]);
    await expect(servicio.reprogramar(1, mover('12:30', '13:30'), ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(citas[0].fechaHoraInicio).toEqual(hora('10:00'));
  });

  it('con otra especialista en ese horario sí se mueve', async () => {
    const { servicio, citas } = montar([
      { fechaHoraInicio: hora('10:00'), fechaHoraFin: hora('11:00') },
      { especialistaId: 'est-2', estado: 'reprogramada', fechaHoraInicio: hora('12:00'), fechaHoraFin: hora('13:00') },
    ]);
    await servicio.reprogramar(1, mover('12:00', '13:00'), ADMIN);
    expect(citas[0]).toMatchObject({ estado: 'reprogramada', fechaHoraInicio: hora('12:00') });
  });

  it('pegada justo antes o justo después de otra cita sí se mueve', async () => {
    const { servicio, citas } = montar([
      { fechaHoraInicio: hora('10:00'), fechaHoraFin: hora('11:00') },
      { estado: 'reprogramada', fechaHoraInicio: hora('12:00'), fechaHoraFin: hora('13:00') },
    ]);
    await servicio.reprogramar(1, mover('13:00', '14:00'), ADMIN);
    expect(citas[0].fechaHoraInicio).toEqual(hora('13:00'));
    await servicio.reprogramar(1, mover('11:00', '12:00'), ADMIN);
    expect(citas[0].fechaHoraInicio).toEqual(hora('11:00'));
  });

  it('valida y escribe dentro de una transacción con candado por especialista', async () => {
    const { servicio, prisma, clavesBloqueadas } = montar([{ fechaHoraInicio: hora('10:00'), fechaHoraFin: hora('11:00') }]);
    await servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(clavesBloqueadas).toEqual(['cita-esp:est-1']);
  });

  it('conserva el anticipo de la cita', async () => {
    const vence = hora('09:00');
    const { servicio, prisma, citas } = montar([{ anticipoRequerido: 150, anticipoVenceEn: vence, anticipoPagadoEn: hora('08:00') }]);
    await servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN);
    const data = prisma.cita.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('anticipoRequerido');
    expect(data).not.toHaveProperty('anticipoVenceEn');
    expect(data).not.toHaveProperty('anticipoPagadoEn');
    expect(citas[0]).toMatchObject({ anticipoRequerido: 150, anticipoVenceEn: vence, anticipoPagadoEn: hora('08:00') });
  });

  it('una cita en curso se reprograma como antes, con la misma validación', async () => {
    const { servicio, citas } = montar([{ estado: 'en_curso' }]);
    await servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN);
    expect(citas[0]).toMatchObject({ estado: 'reprogramada', fechaHoraInicio: hora('15:00') });
  });

  it('el aviso de reprogramada sale después de guardar', async () => {
    const { servicio, eventos, citas } = montar([{}]);
    eventos.emit.mockImplementation(() => expect(citas[0].estado).toBe('reprogramada'));
    await servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN);
    expect(eventos.emit).toHaveBeenCalledWith('cita.reprogramada', expect.objectContaining({ citaId: 1 }));
  });
});

describe('Una cita reprogramada ocupa su horario', () => {
  it('crear encima de una reprogramada responde 400', async () => {
    const { servicio } = montar([{ estado: 'reprogramada', fechaHoraInicio: hora('12:00'), fechaHoraFin: hora('13:00') }]);
    const dto = { clienteId: 'cli-2', especialistaId: 'est-1', servicioId: 5, ...mover('12:30', '13:30') };
    await expect(servicio.crear(dto, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('editar el horario encima de una reprogramada responde 400', async () => {
    const { servicio } = montar([{}, { estado: 'reprogramada', fechaHoraInicio: hora('12:00'), fechaHoraFin: hora('13:00') }]);
    await expect(servicio.actualizar(1, mover('12:30', '13:30'), ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reasignar a otra especialista ocupada a esa hora responde 400', async () => {
    const { servicio, citas } = montar([{}, { especialistaId: 'est-2', estado: 'reprogramada', fechaHoraInicio: hora('10:30'), fechaHoraFin: hora('11:30') }]);
    await expect(servicio.actualizar(1, { especialistaId: 'est-2' } as any, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    expect(citas[0].especialistaId).toBe('est-1');
  });

  it('la disponibilidad no ofrece el horario de una reprogramada', async () => {
    jest.useFakeTimers({ now: new Date(`${DIA}T06:00:00.000-06:00`), doNotFake: ['setImmediate'] });
    try {
      const { servicio } = montar([{ estado: 'reprogramada', fechaHoraInicio: hora('12:00'), fechaHoraFin: hora('13:00') }]);
      const r = await servicio.disponibilidad({ especialistaId: 'est-1', fecha: DIA, servicioId: 5 } as any);
      const inicios = r.slots.map((s) => s.inicio);
      expect(inicios).toContain(hora('11:00').toISOString());
      expect(inicios).not.toContain(hora('11:30').toISOString());
      expect(inicios).not.toContain(hora('12:00').toISOString());
      expect(inicios).not.toContain(hora('12:30').toISOString());
      expect(inicios).toContain(hora('13:00').toISOString());
    } finally {
      jest.useRealTimers();
    }
  });

  it('check-in de una reprogramada la pone en curso', async () => {
    const { servicio, citas } = montar([{ estado: 'reprogramada' }]);
    await servicio.checkIn(1, ADMIN);
    expect(citas[0]).toMatchObject({ estado: 'en_curso', horaCheckIn: expect.any(Date) });
  });
});

describe('Dos movimientos simultáneos al mismo horario', () => {
  it('dos reprogramaciones a la misma hora: una pasa y la otra se rechaza', async () => {
    const { servicio, citas } = montar([
      { fechaHoraInicio: hora('10:00'), fechaHoraFin: hora('11:00') },
      { fechaHoraInicio: hora('11:00'), fechaHoraFin: hora('12:00') },
    ]);
    const r = await Promise.allSettled([
      servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN),
      servicio.reprogramar(2, mover('15:00', '16:00'), ADMIN),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(BadRequestException);
    expect(citas.filter((c) => c.fechaHoraInicio.getTime() === hora('15:00').getTime())).toHaveLength(1);
  });

  it('dos citas nuevas a la misma hora: una pasa y la otra se rechaza', async () => {
    const { servicio, citas } = montar([]);
    const dto = { clienteId: 'cli-2', especialistaId: 'est-1', servicioId: 5, ...mover('15:00', '16:00') };
    const r = await Promise.allSettled([servicio.crear(dto, ADMIN), servicio.crear(dto, ADMIN)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(citas).toHaveLength(1);
  });
});

describe('PATCH /citas/:id: completar y citas ya cobradas', () => {
  it('marcar completada sin hora de salida la pone ahora', async () => {
    const { servicio, prisma } = montar([{ estado: 'en_curso' }]);
    await servicio.actualizar(1, { estado: 'completada' } as any, ADMIN);
    expect(prisma.cita.updateMany.mock.calls[0][0].data).toMatchObject({ estado: 'completada', horaCheckOut: expect.any(Date) });
  });

  it('si ya tenía hora de salida no la cambia', async () => {
    const salida = hora('11:05');
    const { servicio, prisma } = montar([{ estado: 'en_curso', horaCheckOut: salida }]);
    await servicio.actualizar(1, { estado: 'completada' } as any, ADMIN);
    expect(prisma.cita.updateMany.mock.calls[0][0].data).not.toHaveProperty('horaCheckOut');
  });

  /** La cita se lee sin cobrar y el POS la cobra justo antes de que se escriba. */
  function cobrarTrasLeer(m: ReturnType<typeof montar>) {
    const leer = m.prisma.cita.findUnique.getMockImplementation();
    m.prisma.cita.findUnique.mockImplementationOnce(async (args: any) => {
      const r = await leer(args);
      m.citas[0].ventaItem = { id: 9 };
      return r;
    });
  }

  it.each([
    ['reprogramar', (m: ReturnType<typeof montar>) => m.servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN)],
    ['editar el horario', (m: ReturnType<typeof montar>) => m.servicio.actualizar(1, mover('15:00', '16:00'), ADMIN)],
    ['editar las notas', (m: ReturnType<typeof montar>) => m.servicio.actualizar(1, { notas: 'x' } as any, ADMIN)],
  ])('%s cuando el POS la cobra en paralelo responde 409 y no la cambia', async (_caso, accion) => {
    const m = montar([{}]);
    cobrarTrasLeer(m);
    await expect(accion(m)).rejects.toThrow(ConflictException);
    expect(m.citas[0]).toMatchObject({ estado: 'pendiente', notas: null, fechaHoraInicio: hora('10:00') });
  });

  it('una cita cobrada no se edita ni se reprograma (409)', async () => {
    const { servicio, prisma } = montar([{ estado: 'completada', horaCheckOut: hora('11:00'), ventaItem: { id: 9 } }]);
    await expect(servicio.actualizar(1, { notas: 'x' } as any, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    await expect(servicio.reprogramar(1, mover('15:00', '16:00'), ADMIN)).rejects.toThrow('La cita ya se cobró; no se puede editar ni reprogramar. Cancela la venta primero.');
    expect(prisma.cita.update).not.toHaveBeenCalled();
    expect(prisma.cita.updateMany).not.toHaveBeenCalled();
    expect(prisma.cita.findUnique.mock.calls[0][0]).toMatchObject({ include: { ventaItem: expect.anything() } });
  });
});
