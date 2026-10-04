import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { CitasController } from './citas.controller';
import { CitasService } from './citas.service';
import { SeguimientosController } from '../seguimientos/seguimientos.controller';
import type { Solicitante } from '../common/utils/permisos-citas.util';

/**
 * Matriz acordada para citas y seguimientos:
 * - todo el personal LEE todas las citas y seguimientos;
 * - admin escribe todo; estilista y empleado crean y editan cualquier cita y seguimiento;
 * - becario solo atiende, reprograma, cancela y edita SUS citas asignadas, y no crea seguimientos;
 * - una clienta solo ve y modifica sus propias citas.
 * Las claves son las de permisos_rol en producción.
 */
const CLAVES = {
  admin: ['*'],
  estilista: ['citas:escritura', 'seguimientos:lectura', 'seguimientos:escritura', 'clientes:lectura'],
  empleado: ['citas:escritura', 'seguimientos:lectura', 'seguimientos:escritura', 'clientes:lectura'],
  becario: ['citas:asignadas', 'seguimientos:lectura', 'clientes:lectura'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
} as const;

const quien = (id: string, rol: keyof typeof CLAVES): Solicitante => ({ id, rol, claves: [...CLAVES[rol]] });
const CLIENTA_A = quien('cli-a', 'cliente');
const CLIENTA_B = quien('cli-b', 'cliente');
const BECARIO = quien('bec-1', 'becario');
const ESTILISTA = quien('est-1', 'estilista');
const EMPLEADO = quien('emp-1', 'empleado');
const ADMIN = quien('adm-1', 'admin');

const MANANA = new Date(Date.now() + 24 * 60 * 60 * 1000);
const enHoras = (h: number) => new Date(MANANA.getTime() + h * 60 * 60 * 1000).toISOString();

/** Prisma en memoria: dos citas, la #1 de la clienta A atendida por el becario y la #2 de la clienta B. */
function montar() {
  const citas = [
    { id: 1, clienteId: 'cli-a', especialistaId: 'bec-1', estado: 'pendiente', notas: null, fechaHoraInicio: MANANA, fechaHoraFin: MANANA },
    { id: 2, clienteId: 'cli-b', especialistaId: 'est-1', estado: 'pendiente', notas: null, fechaHoraInicio: MANANA, fechaHoraFin: MANANA },
  ];
  const conRelaciones = (c: (typeof citas)[number]) => ({ ...c, servicio: { nombre: 'Corte' }, cliente: { id: c.clienteId } });
  const coincide = (c: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => typeof v !== 'string' || c[k] === v);
  const prisma: any = {
    cita: {
      findUnique: jest.fn(async ({ where }: any) => citas.find((c) => c.id === where.id) ?? null),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ where, data }: any) => {
        const c = citas.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return conRelaciones(c);
      }),
      count: jest.fn(async ({ where }: any) => citas.filter((c) => coincide(c, where)).length),
      findMany: jest.fn(async ({ where }: any) => citas.filter((c) => coincide(c, where)).map(conRelaciones)),
    },
    usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: 'estilista', activo: true })) },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  const inventario = { registrarSalida: jest.fn(async () => ({ data: { ok: true } })) };
  const eventos = { emit: jest.fn() };
  const servicio = new CitasService(prisma, inventario as any, {} as any, eventos as any);
  return { servicio, prisma, citas, eventos, inventario };
}

const cancelarDto = { motivoCancelacion: 'No puedo asistir' } as any;
const reprogramarDto = () => ({ fechaHoraInicio: enHoras(2), fechaHoraFin: enHoras(3) }) as any;

describe('Citas: una clienta nunca lee ni modifica citas ajenas', () => {
  it('cancelar la cita de otra clienta por id responde 404 y no la toca', async () => {
    const { servicio, citas, eventos } = montar();
    await expect(servicio.cancelar(2, cancelarDto, CLIENTA_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(citas[1].estado).toBe('pendiente');
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it('reprogramar la cita de otra clienta responde 404 y no la mueve', async () => {
    const { servicio, citas } = montar();
    await expect(servicio.reprogramar(2, reprogramarDto(), CLIENTA_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(citas[1].estado).toBe('pendiente');
  });

  it('su propia cita sí la puede cancelar y reprogramar', async () => {
    const { servicio, citas } = montar();
    await servicio.reprogramar(1, reprogramarDto(), CLIENTA_A);
    expect(citas[0].estado).toBe('reprogramada');
    await servicio.cancelar(1, cancelarDto, CLIENTA_A);
    expect(citas[0].estado).toBe('cancelada');
  });

  it('listar con ?clienteId de otra clienta solo devuelve las propias', async () => {
    const { servicio } = montar();
    const r = await servicio.listar({ clienteId: 'cli-b' } as any, CLIENTA_A.id, 'cliente');
    expect(r.data.map((c: any) => c.id)).toEqual([1]);
    const b = await servicio.listar({} as any, CLIENTA_B.id, 'cliente');
    expect(b.data.map((c: any) => c.id)).toEqual([2]);
  });

  it('el personal sí puede filtrar por clienteId', async () => {
    const { servicio } = montar();
    const r = await servicio.listar({ clienteId: 'cli-b' } as any, ESTILISTA.id, 'estilista');
    expect(r.data.map((c: any) => c.id)).toEqual([2]);
  });
});

describe('Citas: el becario solo escribe en las citas que tiene asignadas', () => {
  it('check-in, check-out y materiales: en la suya sí, en una ajena 403', async () => {
    const { servicio, citas, inventario } = montar();
    await expect(servicio.checkIn(2, BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
    expect(citas[1].estado).toBe('pendiente');
    await servicio.checkIn(1, BECARIO);
    expect(citas[0].estado).toBe('en_curso');
    await servicio.registrarMateriales(1, { materiales: [{ presentacionId: 3, cantidad: 1 }] } as any, BECARIO);
    expect(inventario.registrarSalida).toHaveBeenCalledWith(expect.anything(), 'bec-1', expect.anything());
    citas[1].estado = 'en_curso';
    await expect(servicio.registrarMateriales(2, { materiales: [{ presentacionId: 3, cantidad: 1 }] } as any, BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.checkOut(2, BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
    await servicio.checkOut(1, BECARIO);
    expect(citas[0].estado).toBe('completada');
  });

  it('reprograma y cancela la suya; en una ajena 403', async () => {
    const { servicio, citas } = montar();
    await expect(servicio.reprogramar(2, reprogramarDto(), BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.cancelar(2, cancelarDto, BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
    await servicio.reprogramar(1, reprogramarDto(), BECARIO);
    expect(citas[0].estado).toBe('reprogramada');
    await servicio.cancelar(1, cancelarDto, BECARIO);
    expect(citas[0].estado).toBe('cancelada');
  });

  it('edita su cita (notas) pero no puede pasársela a otra especialista', async () => {
    const { servicio, citas } = montar();
    await servicio.actualizar(1, { notas: 'Trae fotos de referencia' } as any, BECARIO);
    expect(citas[0].notas).toBe('Trae fotos de referencia');
    await expect(servicio.actualizar(1, { especialistaId: 'est-1' } as any, BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
    expect(citas[0].especialistaId).toBe('bec-1');
    await expect(servicio.actualizar(2, { notas: 'x' } as any, BECARIO)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Citas: estilista, empleado y admin escriben en cualquier cita', () => {
  it.each([
    ['estilista', ESTILISTA],
    ['empleado', EMPLEADO],
    ['admin', ADMIN],
  ])('%s: check-in, reprogramar, editar y cancelar citas de cualquier clienta y especialista', async (_rol, quienEs) => {
    const { servicio, citas } = montar();
    await servicio.checkIn(1, quienEs);
    expect(citas[0].estado).toBe('en_curso');
    await servicio.reprogramar(2, reprogramarDto(), quienEs);
    await servicio.actualizar(2, { especialistaId: 'emp-9', notas: 'Reasignada' } as any, quienEs);
    expect(citas[1].especialistaId).toBe('emp-9');
    await servicio.cancelar(2, cancelarDto, quienEs);
    expect(citas[1].estado).toBe('cancelada');
  });
});

/** Guard real con las claves de producción: qué rol pasa a cada endpoint antes de llegar al servicio. */
async function pasaGuard(clase: any, metodo: string, rol: keyof typeof CLAVES): Promise<boolean> {
  const prisma: any = {
    usuario: { findUnique: jest.fn(async () => ({ rol })) },
    permisoRol: { findUnique: jest.fn(async () => ({ claves: [...CLAVES[rol]] })) },
  };
  const guard = new PermisosGuard(new Reflector(), prisma);
  const contexto: any = {
    getHandler: () => clase.prototype[metodo],
    getClass: () => clase,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-1' } }) }),
  };
  try {
    return await guard.canActivate(contexto);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('Guard de permisos por rol (claves de producción)', () => {
  it.each([
    // [método, admin, estilista, empleado, becario, cliente]
    ['listar', true, true, true, true, true],
    ['crear', true, true, true, false, true],
    ['actualizar', true, true, true, true, false],
    ['checkIn', true, true, true, true, false],
    ['checkOut', true, true, true, true, false],
    ['registrarMateriales', true, true, true, true, false],
    ['reprogramar', true, true, true, true, true],
    ['cancelar', true, true, true, true, true],
  ] as const)('citas.%s', async (metodo, ...esperado) => {
    const roles = ['admin', 'estilista', 'empleado', 'becario', 'cliente'] as const;
    const obtenido = [];
    for (const rol of roles) obtenido.push(await pasaGuard(CitasController, metodo, rol));
    expect(obtenido).toEqual(esperado);
  });

  it.each([
    // [método, admin, estilista, empleado, becario, cliente]
    ['listar', true, true, true, true, false],
    ['crear', true, true, true, false, false],
    ['actualizar', true, true, true, false, false],
  ] as const)('seguimientos.%s', async (metodo, ...esperado) => {
    const roles = ['admin', 'estilista', 'empleado', 'becario', 'cliente'] as const;
    const obtenido = [];
    for (const rol of roles) obtenido.push(await pasaGuard(SeguimientosController, metodo, rol));
    expect(obtenido).toEqual(esperado);
  });
});
