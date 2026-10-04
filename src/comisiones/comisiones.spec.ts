import { BadRequestException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { ReportesController } from '../reportes/reportes.controller';
import { ComisionesController } from './comisiones.controller';
import { ComisionesService } from './comisiones.service';
import { GuardarComisionDto } from './dto/guardar-comision.dto';

const d = (n: number) => new Prisma.Decimal(n);

function montar() {
  const comisiones = new Map<number, any>();
  const perfiles = new Map<string, any>([['aux-1', { usuarioId: 'aux-1', recibeComisiones: false }]]);
  const personal = [
    { id: 'est-1', nombre: 'Mildred', rol: 'estilista', activo: true },
    { id: 'aux-1', nombre: 'Auxiliar', rol: 'empleado', activo: true },
    { id: 'bec-1', nombre: 'Becaria', rol: 'becario', activo: true },
    { id: 'cli-1', nombre: 'Clienta', rol: 'cliente', activo: true },
  ];
  const participaciones = [
    { usuarioId: 'aux-1', comisionMonto: d(100), usuario: { nombre: 'Auxiliar' }, ventaItem: { cantidad: 1, servicio: { nombre: 'Nanoplastia' }, venta: { folio: 'VL-2026-000007', creadoEn: new Date('2026-10-04T18:00:00Z') } } },
    { usuarioId: 'aux-1', comisionMonto: d(100), usuario: { nombre: 'Auxiliar' }, ventaItem: { cantidad: 1, servicio: { nombre: 'Nanoplastia' }, venta: { folio: 'VL-2026-000008', creadoEn: new Date('2026-10-04T19:00:00Z') } } },
    { usuarioId: 'est-1', comisionMonto: d(0), usuario: { nombre: 'Mildred' }, ventaItem: { cantidad: 1, servicio: { nombre: 'Nanoplastia' }, venta: { folio: 'VL-2026-000007', creadoEn: new Date('2026-10-04T18:00:00Z') } } },
  ];
  const prisma: any = {
    servicio: {
      findMany: jest.fn(async () => [{ id: 5, nombre: 'Nanoplastia', precio: d(900), comision: comisiones.get(5) ?? null }]),
      findUnique: jest.fn(async ({ where }: any) => (where.id === 5 ? { id: 5 } : null)),
    },
    comisionServicio: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const actual = comisiones.get(where.servicioId);
        const nueva = actual ? { ...actual, ...update } : { ...create };
        comisiones.set(where.servicioId, nueva);
        return nueva;
      }),
      deleteMany: jest.fn(async ({ where }: any) => ({ count: comisiones.delete(where.servicioId) ? 1 : 0 })),
    },
    usuario: {
      findMany: jest.fn(async () => personal.filter((u) => u.rol !== 'cliente').map((u) => ({ ...u, perfilEmpleado: perfiles.get(u.id) ?? null }))),
      findUnique: jest.fn(async ({ where }: any) => personal.find((u) => u.id === where.id) ?? null),
    },
    perfilEmpleado: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const actual = perfiles.get(where.usuarioId);
        const nuevo = actual ? { ...actual, ...update } : { ...create };
        perfiles.set(where.usuarioId, nuevo);
        return nuevo;
      }),
    },
    ventaItemParticipante: {
      findMany: jest.fn(async ({ where }: any) => participaciones.filter((p) => !where.usuarioId || p.usuarioId === where.usuarioId)),
    },
  };
  return { servicio: new ComisionesService(prisma), prisma, comisiones, perfiles };
}

describe('Comisiones por servicio (monto fijo)', () => {
  it('guarda el monto y quién lo cambió; se puede desactivar y quitar', async () => {
    const { servicio, comisiones } = montar();
    await servicio.guardarComision(5, { monto: 100, activo: true }, 'est-1');
    expect(comisiones.get(5)).toMatchObject({ servicioId: 5, activo: true, actualizadoPorId: 'est-1' });
    expect(Number(comisiones.get(5).monto)).toBe(100);
    await servicio.guardarComision(5, { monto: 120, activo: false }, 'adm-1');
    expect(comisiones.get(5)).toMatchObject({ activo: false, actualizadoPorId: 'adm-1' });
    await servicio.eliminarComision(5);
    expect(comisiones.has(5)).toBe(false);
  });

  it('un servicio que no existe responde 404', async () => {
    const { servicio } = montar();
    await expect(servicio.guardarComision(99, { monto: 100, activo: true }, 'est-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el DTO rechaza montos negativos', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(pipe.transform({ monto: -1, activo: true }, { type: 'body', metatype: GuardarComisionDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Quién recibe comisiones', () => {
  it('activa el interruptor y crea el perfil de empleada si no existe', async () => {
    const { servicio, perfiles } = montar();
    await servicio.cambiarRecibeComisiones('bec-1', true);
    expect(perfiles.get('bec-1')).toMatchObject({ usuarioId: 'bec-1', recibeComisiones: true });
    await servicio.cambiarRecibeComisiones('aux-1', true);
    expect(perfiles.get('aux-1').recibeComisiones).toBe(true);
  });

  it('una clienta no puede recibir comisiones', async () => {
    const { servicio } = montar();
    await expect(servicio.cambiarRecibeComisiones('cli-1', true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lista al personal con su interruptor', async () => {
    const { servicio } = montar();
    const r = await servicio.listarPersonal();
    expect(r.data.map((p: any) => [p.id, p.recibeComisiones])).toEqual([['est-1', false], ['aux-1', false], ['bec-1', false]]);
  });
});

describe('Reporte de comisiones', () => {
  it('con comisiones:configurar ve a todo el personal con sus totales', async () => {
    const { servicio, prisma } = montar();
    const r = await servicio.reporte('2026-10-01', '2026-10-31', { id: 'est-1', rol: 'estilista', claves: ['comisiones:configurar'] });
    expect(r.data.personas.map((p: any) => [p.usuarioId, p.totalComision, p.servicios])).toEqual([['aux-1', 200, 2], ['est-1', 0, 1]]);
    expect(r.data.total).toBe(200);
    const where = prisma.ventaItemParticipante.findMany.mock.calls[0][0].where;
    expect(where.usuarioId).toBeUndefined();
    expect(where.ventaItem.venta.estado).toBe('pagada');
  });

  it('con comisiones:ver_propias solo ve lo suyo', async () => {
    const { servicio, prisma } = montar();
    const r = await servicio.reporte(undefined, undefined, { id: 'aux-1', rol: 'empleado', claves: ['comisiones:ver_propias'] });
    expect(prisma.ventaItemParticipante.findMany.mock.calls[0][0].where.usuarioId).toBe('aux-1');
    expect(r.data.personas.map((p: any) => p.usuarioId)).toEqual(['aux-1']);
  });
});

describe('Guard por rol (claves de producción tras la migración)', () => {
  const CLAVES: Record<string, string[]> = {
    admin: ['*'],
    estilista: ['citas:escritura', 'comisiones:configurar'],
    empleado: ['citas:escritura', 'comisiones:ver_propias'],
    becario: ['citas:asignadas', 'comisiones:ver_propias'],
    cliente: ['citas:propia'],
  };
  async function pasa(clase: any, metodo: string, rol: string) {
    const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = { getHandler: () => clase.prototype[metodo], getClass: () => clase, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }) };
    try { return await guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  }
  const roles = ['admin', 'estilista', 'empleado', 'becario', 'cliente'];
  it.each([
    // [método, admin, estilista, empleado, becario, cliente]
    ['listarServicios', true, true, false, false, false],
    ['guardarComision', true, true, false, false, false],
    ['eliminarComision', true, true, false, false, false],
    ['listarPersonal', true, true, false, false, false],
    ['cambiarRecibeComisiones', true, true, false, false, false],
  ] as const)('comisiones.%s', async (metodo, ...esperado) => {
    const r = [];
    for (const rol of roles) r.push(await pasa(ComisionesController, metodo, rol));
    expect(r).toEqual(esperado);
  });

  it('reportes.comisiones: configurar y ver_propias entran; la clienta no', async () => {
    const r = [];
    for (const rol of roles) r.push(await pasa(ReportesController, 'comisiones', rol));
    expect(r).toEqual([true, true, true, true, false]);
  });
});
