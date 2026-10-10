import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EstadoPedido } from '@prisma/client';
import { PermisosGuard } from './guards/permisos.guard';
import { CitasController } from '../citas/citas.controller';
import { CitasService } from '../citas/citas.service';
import { PedidosService } from '../ecommerce/pedidos/pedidos.service';
import { esPropios } from './utils/alcance-propio.util';

jest.mock('../ecommerce/common/pedido-inventario.util', () => ({
  cantidadPorPresentacion: jest.fn(() => new Map()),
  decrementarStockPresentaciones: jest.fn(async () => undefined),
  incrementarStockPorLineas: jest.fn(async () => undefined),
}));

/**
 * Portal de clienta para todos los roles: con `propios=true` cualquier usuario (estilista, empleado,
 * becario, admin) crea, ve y cambia SOLO lo suyo, y lo ajeno responde 404. Sin `propios` los paneles
 * siguen igual (lo que el personal hace sobre datos ajenos sale de sus claves de permisos_rol).
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['ventas:escritura', 'caja:escritura', 'caja:lectura', 'citas:escritura', 'pedidos:entregar', 'clientes:lectura'],
  empleado: ['ventas:escritura', 'citas:escritura', 'pedidos:entregar', 'clientes:lectura'],
  becario: ['citas:asignadas', 'seguimientos:lectura', 'clientes:lectura'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};
const ROLES_PERSONAL = ['estilista', 'empleado', 'becario', 'admin'] as const;
const OTRA = 'otra-clienta';

describe('esPropios', () => {
  it('solo "true" o "1" activan el modo portal', () => {
    expect(esPropios('true')).toBe(true);
    expect(esPropios('1')).toBe(true);
    expect([undefined, '', 'false', '0', 'si'].map(esPropios)).toEqual([false, false, false, false, false]);
  });
});

// ---------- Citas ----------
function montarCitas(citas: any[]) {
  const creadas: any[] = [];
  const usuarios: Record<string, any> = {
    'est-1': { id: 'est-1', rol: 'estilista', activo: true },
    [OTRA]: { id: OTRA, rol: 'cliente', activo: true },
  };
  for (const r of ROLES_PERSONAL) usuarios[`${r}-yo`] = { id: `${r}-yo`, rol: r, activo: true };
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => usuarios[where.id] ?? null) },
    servicio: { findUnique: jest.fn(async () => ({ id: 5, activo: true })) },
    cita: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async ({ where }: any) => { const c = citas.find((x) => x.id === where.id); return c ? { ...c, servicio: { nombre: 'Corte' } } : null; }),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => { const c = { id: 900, ...data, servicio: { nombre: 'Corte' } }; creadas.push(c); return c; }),
      update: jest.fn(async ({ where, data }: any) => ({ ...citas.find((c) => c.id === where.id), ...data, servicio: { nombre: 'Corte' } })),
      updateMany: jest.fn(async ({ where }: any) => ({ count: citas.some((c) => c.id === where.id) ? 1 : 0 })),
    },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    $executeRaw: jest.fn(async () => 1),
  };
  const servicio = new CitasService(prisma, {} as any, {} as any, { emit: jest.fn() } as any);
  return { servicio, prisma, creadas };
}

const solicitante = (rol: string) => ({ id: `${rol}-yo`, rol, claves: CLAVES[rol] });
const cuerpoCita = (extra: Record<string, unknown> = {}) => ({ especialistaId: 'est-1', servicioId: 5, fechaHoraInicio: '2026-10-10T16:00:00.000Z', fechaHoraFin: '2026-10-10T17:00:00.000Z', ...extra });

describe.each(ROLES_PERSONAL)('Citas en el portal como clienta: %s', (rol) => {
  const yo = `${rol}-yo`;
  const propia = { id: 1, clienteId: yo, especialistaId: 'est-1', servicioId: 5, estado: 'pendiente', notas: null };
  const ajena = { id: 2, clienteId: OTRA, especialistaId: yo, servicioId: 5, estado: 'pendiente', notas: null };

  it('agenda su cita y queda como clienta aunque mande otro clienteId', async () => {
    const { servicio, creadas } = montarCitas([]);
    await servicio.crear(cuerpoCita({ clienteId: OTRA }) as any, solicitante(rol), true);
    expect(creadas[0].clienteId).toBe(yo);
  });

  it('"Mis citas" lista solo las suyas', async () => {
    const { servicio, prisma } = montarCitas([]);
    await servicio.listar({ propios: true, clienteId: OTRA } as any, yo, rol);
    expect(prisma.cita.findMany.mock.calls[0][0].where.clienteId).toBe(yo);
  });

  it('ve, reprograma y cancela la suya', async () => {
    const { servicio } = montarCitas([propia]);
    await expect(servicio.obtener(1, yo, rol, true)).resolves.toMatchObject({ success: true });
    await expect(servicio.reprogramar(1, { fechaHoraInicio: '2026-10-11T16:00:00.000Z', fechaHoraFin: '2026-10-11T17:00:00.000Z' } as any, solicitante(rol), true)).resolves.toMatchObject({ success: true });
    await expect(servicio.cancelar(1, { motivoCancelacion: 'No puedo ir' } as any, solicitante(rol), true)).resolves.toMatchObject({ success: true });
  });

  it('la de otra persona responde 404 al verla o cambiarla (aunque la atienda o tenga escritura)', async () => {
    const { servicio, prisma } = montarCitas([ajena]);
    await expect(servicio.obtener(2, yo, rol, true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.reprogramar(2, { fechaHoraInicio: '2026-10-11T16:00:00.000Z', fechaHoraFin: '2026-10-11T17:00:00.000Z' } as any, solicitante(rol), true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.cancelar(2, { motivoCancelacion: 'x' } as any, solicitante(rol), true)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.cita.update).not.toHaveBeenCalled();
  });
});

describe('Citas fuera del portal: los paneles no cambian', () => {
  it('sin citas:escritura (becario) la cita siempre queda a su nombre', async () => {
    const { servicio, creadas } = montarCitas([]);
    await servicio.crear(cuerpoCita({ clienteId: OTRA }) as any, solicitante('becario'), false);
    expect(creadas[0].clienteId).toBe('becario-yo');
  });

  it('con citas:escritura el personal agenda para otra clienta como antes', async () => {
    const { servicio, creadas } = montarCitas([]);
    await servicio.crear(cuerpoCita({ clienteId: OTRA }) as any, solicitante('estilista'), false);
    expect(creadas[0].clienteId).toBe(OTRA);
  });

  it('la estilista sigue pudiendo cancelar una cita ajena desde el panel', async () => {
    const { servicio } = montarCitas([{ id: 2, clienteId: OTRA, especialistaId: 'est-1', servicioId: 5, estado: 'pendiente' }]);
    await expect(servicio.cancelar(2, { motivoCancelacion: 'x' } as any, solicitante('estilista'))).resolves.toMatchObject({ success: true });
  });

  it('el becario sigue sin poder cancelar una cita ajena que no tiene asignada', async () => {
    const { servicio } = montarCitas([{ id: 2, clienteId: OTRA, especialistaId: 'est-1', servicioId: 5, estado: 'pendiente' }]);
    await expect(servicio.cancelar(2, { motivoCancelacion: 'x' } as any, solicitante('becario'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Guard con las claves de producción: todos los roles entran a su portal de citas', () => {
  async function pasa(metodo: string, rol: string) {
    const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = { getHandler: () => (CitasController.prototype as any)[metodo], getClass: () => CitasController, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }) };
    try { return await guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  }
  it.each(['listar', 'obtener', 'crear', 'reprogramar', 'cancelar'])('%s', async (metodo) => {
    for (const rol of [...ROLES_PERSONAL, 'cliente']) expect([rol, await pasa(metodo, rol)]).toEqual([rol, true]);
  });
});

// ---------- Pedidos ----------
const ROL_DE = (id: string) => (id === OTRA ? 'cliente' : id.replace(/-yo$/, ''));
function montarPedidos(pedidos: any[]) {
  const creados: any[] = [];
  const tx: any = {
    pedidoItem: { findMany: jest.fn(async () => []) },
    pedido: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ where, data }: any) => ({ ...pedidos.find((p) => p.id === where.id), ...data })),
      create: jest.fn(async ({ data }: any) => { creados.push(data); return { id: 50, ...data }; }),
      findUnique: jest.fn(async ({ where }: any) => pedidos.find((p) => p.id === where.id) ?? null),
    },
    historialEstadoPedido: { create: jest.fn(async () => ({})) },
    pago: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    pedido: {
      findUnique: jest.fn(async ({ where }: any) => pedidos.find((p) => p.id === where.id) ?? null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    productoPresentacion: { findMany: jest.fn(async () => [{ id: 3, productoId: 1, precio: 100, stock: 10, disponible: true, producto: { id: 1, activo: true, nombre: 'Shampoo' } }]), findUnique: jest.fn(async () => ({ id: 3, productoId: 1, precio: 100, stock: 10, disponible: true, producto: { id: 1, activo: true, nombre: 'Shampoo' } })) },
    producto: { findUnique: jest.fn(async () => ({ id: 1, activo: true, nombre: 'Shampoo' })) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => ({ claves: CLAVES[where.rol] ?? [] })) },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
  };
  const access = { getRol: jest.fn(async (id: string) => ROL_DE(id)), isAdmin: (r: string | null) => r === 'admin' };
  return { servicio: new PedidosService(prisma, access as any, { emit: jest.fn() } as any), prisma, tx, creados };
}

describe.each(ROLES_PERSONAL)('Pedidos en el portal como clienta: %s', (rol) => {
  const yo = `${rol}-yo`;
  const propio = { id: 1, usuarioId: yo, estado: EstadoPedido.pendiente_pago, metodoPago: 'pago_en_salon', pagadoEn: null };
  const ajeno = { id: 2, usuarioId: OTRA, estado: EstadoPedido.pendiente_pago, metodoPago: 'pago_en_salon', pagadoEn: null };

  it('"Mis pedidos" lista solo los suyos aunque pueda ver los de otras', async () => {
    const { servicio, prisma } = montarPedidos([]);
    await servicio.listar(yo, { propios: true, usuarioId: OTRA });
    expect(prisma.pedido.findMany.mock.calls[0][0].where.usuarioId).toBe(yo);
  });

  it('crea su pedido a su nombre y con las reglas de clienta (no puede nacer pagado)', async () => {
    const { servicio } = montarPedidos([]);
    await expect(servicio.crear(yo, { estado: EstadoPedido.pagado, items: [{ presentacionId: 3, cantidad: 1 }] } as any, true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.crear(yo, { usuarioId: OTRA, estado: EstadoPedido.pendiente_pago, items: [{ presentacionId: 3, cantidad: 1 }] } as any, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ve el suyo y lo cancela antes de que se prepare', async () => {
    const { servicio } = montarPedidos([propio]);
    await expect(servicio.obtenerPorId(1, yo, true)).resolves.toMatchObject({ success: true });
    await expect(servicio.actualizar(1, yo, { estado: EstadoPedido.cancelado } as any, true)).resolves.toBeDefined();
  });

  it('en preparación ya no lo cancela desde el portal (regla de clienta, aunque tenga caja)', async () => {
    const { servicio } = montarPedidos([{ ...propio, estado: EstadoPedido.preparando }]);
    await expect(servicio.actualizar(1, yo, { estado: EstadoPedido.cancelado } as any, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el de otra persona responde 404 al verlo o cambiarlo', async () => {
    const { servicio, tx } = montarPedidos([ajeno]);
    await expect(servicio.obtenerPorId(2, yo, true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.actualizar(2, yo, { estado: EstadoPedido.cancelado } as any, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
  });
});

describe('Pedidos fuera del portal: los paneles no cambian', () => {
  it('la estilista sigue viendo todos los pedidos en su panel', async () => {
    const { servicio, prisma } = montarPedidos([]);
    await servicio.listar('estilista-yo', {});
    expect(prisma.pedido.findMany.mock.calls[0][0].where.usuarioId).toBeUndefined();
  });

  it('el becario (sin caja ni entregas) sigue viendo solo los suyos', async () => {
    const { servicio, prisma } = montarPedidos([]);
    await servicio.listar('becario-yo', {});
    expect(prisma.pedido.findMany.mock.calls[0][0].where.usuarioId).toBe('becario-yo');
  });
});
