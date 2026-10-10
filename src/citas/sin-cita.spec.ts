import { BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { CitasController } from './citas.controller';
import { CitasService } from './citas.service';
import { CrearCitaSinCitaDto } from './dto/crear-cita-sin-cita.dto';
import { PorCobrarDto } from './dto/por-cobrar.dto';

const AHORA = new Date('2026-10-04T17:00:00.000Z');
const minutos = (m: number) => new Date(AHORA.getTime() + m * 60_000);

type CitaMem = { id: number; clienteId: string | null; especialistaId: string; estado: string; fechaHoraInicio: Date; fechaHoraFin: Date; horaCheckOut?: Date | null; ventaItem?: unknown };

function montar(opciones: { citas?: CitaMem[]; asignados?: { servicioId: number; usuarioId: string }[] } = {}) {
  const citas: CitaMem[] = opciones.citas ?? [];
  const asignados = opciones.asignados ?? [];
  const personal = [
    { id: 'est-1', nombre: 'Mildred', rol: 'estilista', activo: true, foto: null },
    { id: 'aux-1', nombre: 'Auxiliar', rol: 'empleado', activo: true, foto: null },
    { id: 'bec-1', nombre: 'Becaria', rol: 'becario', activo: true, foto: null },
  ];
  const creadas: any[] = [];
  const porCobrar = (where: any) =>
    citas.filter((c) => c.estado === 'completada' && c.horaCheckOut && !c.ventaItem && (where.id === undefined || c.id === where.id));
  const prisma: any = {
    usuario: {
      findUnique: jest.fn(async ({ where }: any) => personal.find((u) => u.id === where.id) ?? (where.id === 'cli-1' ? { id: 'cli-1', activo: true, rol: 'cliente' } : null)),
      findMany: jest.fn(async ({ where }: any) => personal.filter((u) => where.rol.in.includes(u.rol) && u.activo && (!where.id || where.id.in.includes(u.id)))),
    },
    servicio: { findUnique: jest.fn(async ({ where }: any) => (where.id === 5 ? { id: 5, activo: true, nombre: 'Nanoplastia', duracionMinutos: 90 } : null)) },
    servicioEspecialista: { findMany: jest.fn(async ({ where }: any) => asignados.filter((a) => a.servicioId === where.servicioId)) },
    cita: {
      findFirst: jest.fn(async ({ where }: any) =>
        citas.find((c) => c.especialistaId === where.especialistaId && where.estado.in.includes(c.estado) && c.fechaHoraInicio < where.fechaHoraInicio.lt && c.fechaHoraFin > where.fechaHoraFin.gt) ?? null),
      findMany: jest.fn(async ({ where, skip, take }: any) => {
        if (where.horaCheckOut) return porCobrar(where).slice(skip ?? 0, (skip ?? 0) + (take ?? Infinity));
        return citas.filter((c) => where.especialistaId.in.includes(c.especialistaId) && where.OR.some((o: any) => {
          const enRango = (o.fechaHoraInicio?.gte === undefined || c.fechaHoraInicio >= o.fechaHoraInicio.gte) && (o.fechaHoraInicio?.lte === undefined || c.fechaHoraInicio <= o.fechaHoraInicio.lte);
          if (o.estado === c.estado) return enRango;
          return o.estado?.in?.includes(c.estado) && c.fechaHoraInicio < o.fechaHoraInicio.lt && c.fechaHoraFin > o.fechaHoraFin.gt;
        }));
      }),
      count: jest.fn(async ({ where }: any) => porCobrar(where).length),
      findUnique: jest.fn(async ({ where }: any) => citas.find((c) => c.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const c = { id: 100 + creadas.length, ...data, servicio: { nombre: 'Nanoplastia' } };
        creadas.push(c);
        return c;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ ...citas.find((c) => c.id === where.id), ...data, servicio: { nombre: 'Nanoplastia' } })),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  prisma.$transaction = jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const eventos = { emit: jest.fn() };
  const servicio = new CitasService(prisma, {} as any, {} as any, eventos as any);
  return { servicio, prisma, creadas, eventos };
}

describe('POST /api/citas/sin-cita: turno de una persona que llega sin cita', () => {
  beforeAll(() => jest.useFakeTimers({ now: AHORA }));
  afterAll(() => jest.useRealTimers());

  it('con nombre y teléfono crea una cita inmediata con origen sin_cita y duración del servicio', async () => {
    const { servicio, creadas } = montar();
    await servicio.crearSinCita({ nombre: ' Ana López ', telefono: '7711234567', servicioId: 5, especialistaId: 'est-1' });
    expect(creadas[0]).toMatchObject({
      clienteId: null, nombreInvitado: 'Ana López', telefonoInvitado: '7711234567', origen: 'sin_cita',
      especialistaId: 'est-1', servicioId: 5, estado: 'pendiente', fechaHoraInicio: AHORA, fechaHoraFin: minutos(90),
    });
  });

  it('con iniciarAhora queda en curso con hora de llegada', async () => {
    const { servicio, creadas } = montar();
    await servicio.crearSinCita({ nombre: 'Ana', servicioId: 5, especialistaId: 'est-1', iniciarAhora: true });
    expect(creadas[0]).toMatchObject({ estado: 'en_curso', horaCheckIn: AHORA });
  });

  it('una clienta registrada se liga por clienteId, sin nombre de invitada', async () => {
    const { servicio, creadas } = montar();
    await servicio.crearSinCita({ clienteId: 'cli-1', servicioId: 5, especialistaId: 'est-1' });
    expect(creadas[0]).toMatchObject({ clienteId: 'cli-1', nombreInvitado: null, origen: 'sin_cita' });
  });

  it('sin nombre ni clienta responde 400', async () => {
    const { servicio } = montar();
    await expect(servicio.crearSinCita({ servicioId: 5, especialistaId: 'est-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una clienta que no existe responde 404', async () => {
    const { servicio } = montar();
    await expect(servicio.crearSinCita({ clienteId: 'no-existe', servicioId: 5, especialistaId: 'est-1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('si la especialista está ocupada ahora responde 400', async () => {
    const { servicio } = montar({ citas: [{ id: 1, clienteId: 'x', especialistaId: 'est-1', estado: 'en_curso', fechaHoraInicio: minutos(-30), fechaHoraFin: minutos(30) }] });
    await expect(servicio.crearSinCita({ nombre: 'Ana', servicioId: 5, especialistaId: 'est-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el DTO limpia y valida: nombre máximo 120, teléfono opcional', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const dto = await pipe.transform({ nombre: 'Ana', servicioId: '5', especialistaId: '11111111-1111-4111-8111-111111111111' }, { type: 'body', metatype: CrearCitaSinCitaDto });
    expect(dto.servicioId).toBe(5);
    await expect(pipe.transform({ nombre: 'x'.repeat(121), servicioId: 5, especialistaId: '11111111-1111-4111-8111-111111111111' }, { type: 'body', metatype: CrearCitaSinCitaDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GET /api/citas/especialistas-libres', () => {
  beforeAll(() => jest.useFakeTimers({ now: AHORA }));
  afterAll(() => jest.useRealTimers());

  it('sin especialistas asignados al servicio considera a todo el personal y quita a quien está ocupado', async () => {
    const { servicio } = montar({ citas: [{ id: 1, clienteId: 'x', especialistaId: 'aux-1', estado: 'en_curso', fechaHoraInicio: minutos(-200), fechaHoraFin: minutos(-10) }] });
    const r = await servicio.especialistasLibres(5);
    expect(r.data.map((e: any) => e.id).sort()).toEqual(['bec-1', 'est-1']);
  });

  it('una cita agendada que choca con el lapso del servicio también la ocupa', async () => {
    const { servicio } = montar({ citas: [{ id: 2, clienteId: 'x', especialistaId: 'est-1', estado: 'confirmada', fechaHoraInicio: minutos(60), fechaHoraFin: minutos(120) }] });
    const r = await servicio.especialistasLibres(5);
    expect(r.data.map((e: any) => e.id)).not.toContain('est-1');
  });

  it('una cita reprogramada que choca con el lapso del servicio también la ocupa', async () => {
    const { servicio } = montar({ citas: [{ id: 2, clienteId: 'x', especialistaId: 'est-1', estado: 'reprogramada', fechaHoraInicio: minutos(30), fechaHoraFin: minutos(90) }] });
    const r = await servicio.especialistasLibres(5);
    expect(r.data.map((e: any) => e.id)).not.toContain('est-1');
  });

  it('una cita en curso olvidada de ayer ya no la ocupa; una de hoy sí', async () => {
    const ayer = montar({ citas: [{ id: 1, clienteId: 'x', especialistaId: 'aux-1', estado: 'en_curso', fechaHoraInicio: minutos(-24 * 60 - 60), fechaHoraFin: minutos(-24 * 60) }] });
    expect((await ayer.servicio.especialistasLibres(5)).data.map((e: any) => e.id)).toContain('aux-1');
    const hoy = montar({ citas: [{ id: 1, clienteId: 'x', especialistaId: 'aux-1', estado: 'en_curso', fechaHoraInicio: minutos(-60), fechaHoraFin: minutos(-30) }] });
    expect((await hoy.servicio.especialistasLibres(5)).data.map((e: any) => e.id)).not.toContain('aux-1');
  });

  it('si el servicio tiene especialistas asignadas, solo ellas', async () => {
    const { servicio } = montar({ asignados: [{ servicioId: 5, usuarioId: 'est-1' }] });
    const r = await servicio.especialistasLibres(5);
    expect(r.data.map((e: any) => e.id)).toEqual(['est-1']);
  });
});

describe('GET /api/citas/personal', () => {
  it('lista al personal activo que atiende (para elegir participantes al cobrar)', async () => {
    const { servicio } = montar();
    const r = await servicio.personal();
    expect(r.data.map((p: any) => p.id)).toEqual(['est-1', 'aux-1', 'bec-1']);
  });
});

describe('Finalizar y cobrar', () => {
  it('check-out guarda la hora de salida', async () => {
    const { servicio, prisma } = montar({ citas: [{ id: 3, clienteId: null, especialistaId: 'est-1', estado: 'en_curso', fechaHoraInicio: AHORA, fechaHoraFin: AHORA }] });
    await servicio.checkOut(3, { id: 'est-1', rol: 'estilista', claves: ['citas:escritura'] });
    expect(prisma.cita.update.mock.calls[0][0].data).toMatchObject({ estado: 'completada', horaCheckOut: expect.any(Date) });
  });

  it('por cobrar: solo citas finalizadas con hora de salida y sin venta', async () => {
    const { servicio, prisma } = montar({ citas: [
      { id: 4, clienteId: null, especialistaId: 'est-1', estado: 'completada', fechaHoraInicio: AHORA, fechaHoraFin: AHORA, horaCheckOut: AHORA },
      { id: 5, clienteId: 'c', especialistaId: 'est-1', estado: 'completada', fechaHoraInicio: AHORA, fechaHoraFin: AHORA, horaCheckOut: AHORA, ventaItem: { id: 1 } },
      { id: 6, clienteId: 'c', especialistaId: 'est-1', estado: 'completada', fechaHoraInicio: AHORA, fechaHoraFin: AHORA, horaCheckOut: null },
    ] });
    const r = await servicio.porCobrar();
    expect(r.data.map((c: any) => c.id)).toEqual([4]);
    expect(prisma.cita.findMany.mock.calls[0][0].where).toMatchObject({ estado: 'completada', horaCheckOut: { not: null }, ventaItem: null });
  });

  const cobrables = (n: number): CitaMem[] =>
    Array.from({ length: n }, (_, i) => ({ id: 10 + i, clienteId: null, especialistaId: 'est-1', estado: 'completada', fechaHoraInicio: AHORA, fechaHoraFin: AHORA, horaCheckOut: AHORA }));

  it('por cobrar pagina de verdad: total, página, límite y páginas', async () => {
    const { servicio } = montar({ citas: cobrables(3) });
    const r = await servicio.porCobrar({ page: 2, limit: 2 });
    expect(r).toMatchObject({ success: true, count: 3, page: 2, limit: 2, totalPages: 2 });
    expect(r.data.map((c: any) => c.id)).toEqual([12]);
  });

  it('por cobrar sin parámetros: página 1 de 20', async () => {
    const { servicio, prisma } = montar({ citas: cobrables(25) });
    const r = await servicio.porCobrar();
    expect(r).toMatchObject({ count: 25, page: 1, limit: 20, totalPages: 2 });
    expect(r.data).toHaveLength(20);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('por cobrar con citaId busca solo esa cita', async () => {
    const { servicio } = montar({ citas: cobrables(3) });
    const r = await servicio.porCobrar({ citaId: 11 });
    expect(r.count).toBe(1);
    expect(r.data.map((c: any) => c.id)).toEqual([11]);
  });

  it('el DTO de por cobrar convierte y valida page, limit (1 a 100) y citaId', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const valida = (q: Record<string, string>) => pipe.transform(q, { type: 'query', metatype: PorCobrarDto });
    await expect(valida({ page: '2', limit: '100', citaId: '7' })).resolves.toMatchObject({ page: 2, limit: 100, citaId: 7 });
    for (const malo of [{ page: '0' }, { limit: '0' }, { limit: '101' }, { citaId: 'x' }, { otro: '1' }]) {
      await expect(valida(malo)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

describe('Guard por rol de los endpoints nuevos (claves de producción)', () => {
  const CLAVES: Record<string, string[]> = {
    admin: ['*'],
    estilista: ['citas:escritura', 'ventas:escritura', 'comisiones:configurar'],
    empleado: ['citas:escritura', 'ventas:escritura', 'comisiones:ver_propias'],
    becario: ['citas:asignadas', 'comisiones:ver_propias'],
    cliente: ['citas:propia'],
  };
  async function pasa(metodo: string, rol: string) {
    const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = { getHandler: () => (CitasController.prototype as any)[metodo], getClass: () => CitasController, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }) };
    try { return await guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  }
  it.each([
    // [método, admin, estilista, empleado, becario, cliente]
    ['crearSinCita', true, true, true, false, false],
    ['especialistasLibres', true, true, true, true, false],
    ['porCobrar', true, true, true, false, false],
    ['personal', true, true, true, true, false],
  ] as const)('%s', async (metodo, ...esperado) => {
    const r = [];
    for (const rol of ['admin', 'estilista', 'empleado', 'becario', 'cliente']) r.push(await pasa(metodo, rol));
    expect(r).toEqual(esperado);
  });
});
