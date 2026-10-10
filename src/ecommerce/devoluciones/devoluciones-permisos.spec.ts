import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DevolucionesController } from './devoluciones.controller';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { DevolucionesService } from './devoluciones.service';

/**
 * Devoluciones: la clienta solo pide cambio o reembolso de SUS pedidos; el estado nace pendiente y el
 * monto lo calcula el backend. Resolver (aprobar o rechazar) es del personal con devoluciones:gestionar.
 * Claves como en producción (la migración 20261010120000 agrega devoluciones:gestionar a la estilista).
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'seguimientos:lectura', 'clientes:lectura', 'pedidos:entregar', 'devoluciones:gestionar'],
  empleado: ['ventas:escritura', 'citas:escritura', 'pedidos:entregar'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'cli-2': 'cliente', 'est-1': 'estilista', 'emp-1': 'empleado', 'adm-1': 'admin' };

const ENTREGADO = new Date();
const pedidoDe = (id: number, usuarioId: string, extra: Record<string, unknown> = {}) => ({
  id,
  usuarioId,
  estado: 'entregado',
  pagadoEn: ENTREGADO,
  metodoPago: 'pago_en_salon',
  total: '450.00',
  historialEstado: [
    { estadoNuevo: 'entregado', creadoEn: ENTREGADO },
    { estadoNuevo: 'listo_recoger', creadoEn: ENTREGADO },
  ],
  ...extra,
});

/** Filtro mínimo de Prisma para los mocks: igualdad, { in }, { not } y OR. */
function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => coincide(fila, w));
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(fila[k]);
    if (v && typeof v === 'object' && 'not' in v) return fila[k] !== v.not;
    return (fila[k] ?? null) === v;
  });
}

function montar(opts: { pedidos?: any[]; items?: any[]; pagos?: any[]; devoluciones?: any[]; updateCount?: number } = {}) {
  const pedidos = opts.pedidos ?? [pedidoDe(9, 'cli-1'), pedidoDe(10, 'cli-2'), pedidoDe(11, 'est-1')];
  const items = opts.items ?? [{ id: 3, pedidoId: 9, subtotal: '120.00' }, { id: 4, pedidoId: 10, subtotal: '80.00' }, { id: 5, pedidoId: 11, subtotal: '60.00' }];
  const pagos = opts.pagos ?? [{ id: 7, pedidoId: 9 }, { id: 8, pedidoId: 10 }];
  const devoluciones = opts.devoluciones ?? [];
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    pedido: { findUnique: jest.fn(async ({ where }: any) => pedidos.find((p) => p.id === where.id) ?? null) },
    pedidoItem: { findUnique: jest.fn(async ({ where }: any) => items.find((i) => i.id === where.id) ?? null) },
    pago: {
      findUnique: jest.fn(async ({ where }: any) => pagos.find((p) => p.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => pagos.find((p) => coincide(p, where)) ?? null),
    },
    devolucion: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findUnique: jest.fn(async ({ where }: any) => devoluciones.find((d) => d.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => devoluciones.find((d) => coincide(d, where)) ?? null),
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: { monto: devoluciones.filter((d) => coincide(d, where)).reduce((t, d) => t + Number(d.monto ?? 0), 0) },
      })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      updateMany: jest.fn(async () => ({ count: opts.updateCount ?? 1 })),
      delete: jest.fn(async () => ({})),
    },
    movimientoCaja: { create: jest.fn(async ({ data }: any) => ({ id: 70, ...data })) },
  };
  prisma.$transaction = jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  prisma.$executeRaw = jest.fn(async () => 1);
  return { servicio: new DevolucionesService(prisma), prisma };
}

const cambio = (extra: Record<string, unknown> = {}) => ({ pedidoId: 9, pedidoItemId: 3, tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true, motivo: 'Otro tono', ...extra });

describe('Crear solicitud: la clienta y sus pedidos', () => {
  it('el estado siempre nace pendiente aunque la clienta mande otro', async () => {
    const { servicio, prisma } = montar();
    await servicio.crear('cli-1', cambio({ estado: 'aprobada' }) as any);
    expect(prisma.devolucion.create.mock.calls[0][0].data.estado).toBe('pendiente');
  });

  it('el monto lo calcula el backend: cambio sin monto, aunque la clienta mande uno', async () => {
    const { servicio, prisma } = montar();
    await servicio.crear('cli-1', cambio({ monto: 9999 }) as any);
    expect(prisma.devolucion.create.mock.calls[0][0].data.monto).toBeNull();
  });

  it('reembolso de un artículo: el monto es el subtotal de ese artículo', async () => {
    const { servicio, prisma } = montar();
    await servicio.crear('cli-1', { pedidoId: 9, pedidoItemId: 3, tipo: 'reembolso', causa: 'defecto_fabrica', monto: 9999 } as any);
    expect(String(prisma.devolucion.create.mock.calls[0][0].data.monto)).toBe('120.00');
  });

  it('reembolso sin artículo: el monto es el total del pedido', async () => {
    const pedidos = [pedidoDe(9, 'cli-1', { estado: 'cancelado', historialEstado: [] })];
    const { servicio, prisma } = montar({ pedidos });
    await servicio.crear('cli-1', { pedidoId: 9, tipo: 'reembolso', causa: 'sin_existencias' } as any);
    expect(String(prisma.devolucion.create.mock.calls[0][0].data.monto)).toBe('450.00');
  });

  it('guarda tipo y causa en sus columnas', async () => {
    const { servicio, prisma } = montar();
    await servicio.crear('cli-1', cambio() as any);
    expect(prisma.devolucion.create.mock.calls[0][0].data).toMatchObject({ tipo: 'cambio', causa: 'sellado_sin_abrir' });
  });

  it('el pedido de otra persona responde 404 y no guarda', async () => {
    const { servicio, prisma } = montar();
    await expect(servicio.crear('cli-1', cambio({ pedidoId: 10, pedidoItemId: 4 }) as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.devolucion.create).not.toHaveBeenCalled();
  });

  it('un empleado sin devoluciones:gestionar tampoco crea sobre un pedido ajeno', async () => {
    const { servicio } = montar();
    await expect(servicio.crear('emp-1', cambio({ pedidoId: 10, pedidoItemId: 4 }) as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la estilista con devoluciones:gestionar crea sobre un pedido ajeno desde el panel', async () => {
    const { servicio, prisma } = montar();
    await servicio.crear('est-1', cambio({ pedidoId: 10, pedidoItemId: 4 }) as any);
    expect(prisma.devolucion.create).toHaveBeenCalled();
  });

  it('con propios=true la estilista solo crea sobre sus pedidos', async () => {
    const { servicio, prisma } = montar();
    await expect(servicio.crear('est-1', cambio({ pedidoId: 10, pedidoItemId: 4 }) as any, true)).rejects.toBeInstanceOf(NotFoundException);
    await servicio.crear('est-1', cambio({ pedidoId: 11, pedidoItemId: 5 }) as any, true);
    expect(prisma.devolucion.create).toHaveBeenCalledTimes(1);
  });

  it('sin tipo o sin causa responde 400', async () => {
    const { servicio, prisma } = montar();
    await expect(servicio.crear('cli-1', { pedidoId: 9, pedidoItemId: 3, motivo: 'No me gustó' } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.crear('cli-1', { pedidoId: 9, pedidoItemId: 3, tipo: 'cambio' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.devolucion.create).not.toHaveBeenCalled();
  });

  it('la política se valida siempre: un reembolso por arrepentimiento responde 400', async () => {
    const { servicio, prisma } = montar();
    await expect(servicio.crear('cli-1', { pedidoId: 9, pedidoItemId: 3, tipo: 'reembolso', causa: 'sellado_sin_abrir' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.devolucion.create).not.toHaveBeenCalled();
  });

  it('el artículo de otro pedido responde 400', async () => {
    const { servicio } = montar();
    await expect(servicio.crear('cli-1', cambio({ pedidoItemId: 4 }) as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el pago de otro pedido responde 400', async () => {
    const { servicio } = montar();
    await expect(servicio.crear('cli-1', cambio({ pagoId: 8 }) as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DTO de creación (whitelist + forbidNonWhitelisted, como main.ts)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const validar = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: CreateDevolucionDto });

  it('rechaza estado y monto mandados por la clienta', async () => {
    await expect(validar({ ...cambio(), estado: 'aprobada' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ ...cambio(), monto: 10 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tipo y causa son obligatorios', async () => {
    await expect(validar({ pedidoId: 9, pedidoItemId: 3, causa: 'sellado_sin_abrir' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ pedidoId: 9, pedidoItemId: 3, tipo: 'cambio' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar(cambio())).resolves.toBeInstanceOf(CreateDevolucionDto);
  });
});

const solicitud = (extra: Record<string, unknown> = {}) => ({ id: 20, pedidoId: 9, estado: 'pendiente', tipo: 'reembolso', causa: 'defecto_fabrica', monto: '120.00', pedido: { usuarioId: 'cli-1' }, ...extra });

describe('Cancelar: solo la dueña y solo pendiente', () => {
  it('la dueña cancela su solicitud pendiente con un updateMany condicionado al estado', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()] });
    await servicio.cancelar(20, 'cli-1');
    expect(prisma.devolucion.updateMany).toHaveBeenCalledWith({ where: { id: 20, estado: 'pendiente' }, data: { estado: 'cancelada' } });
  });

  it('si ya no está pendiente (otra petición la resolvió) responde 409', async () => {
    const { servicio } = montar({ devoluciones: [solicitud({ estado: 'aprobada' })], updateCount: 0 });
    await expect(servicio.cancelar(20, 'cli-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('la de otra persona responde 404, aunque quien pida sea personal con la clave', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()] });
    await expect(servicio.cancelar(20, 'cli-2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.cancelar(20, 'est-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.devolucion.updateMany).not.toHaveBeenCalled();
  });
});

describe('Aprobar y rechazar (personal con devoluciones:gestionar)', () => {
  it('aprobar guarda quién, cuándo y la nota, solo desde pendiente', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()] });
    await servicio.aprobar(20, 'est-1', { nota: 'Defecto confirmado' });
    const arg = prisma.devolucion.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 20, estado: 'pendiente' });
    expect(arg.data).toMatchObject({ estado: 'aprobada', resueltoPorId: 'est-1', notaResolucion: 'Defecto confirmado', metodoReembolso: 'metodo_original' });
    expect(arg.data.resueltoEn).toBeInstanceOf(Date);
    expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
  });

  it('crear y aprobar usan una transacción con tiempo holgado (la latencia a Neon superaba los 5 s por defecto)', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()] });
    await servicio.aprobar(20, 'est-1', { metodoReembolso: 'efectivo' });
    expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 15_000 });
    const otro = montar();
    await otro.servicio.crear('cli-1', cambio() as any);
    expect(otro.prisma.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 15_000 });
  });

  it('aprobar un reembolso en efectivo registra la salida de caja en la misma transacción', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()] });
    await servicio.aprobar(20, 'est-1', { metodoReembolso: 'efectivo' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const salida = prisma.movimientoCaja.create.mock.calls[0][0].data;
    expect(salida).toMatchObject({ concepto: 'reembolso_devolucion', registradoPorId: 'est-1', devolucionId: 20 });
    expect(String(salida.monto)).toBe('120');
  });

  it('un cambio no lleva método de reembolso', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud({ tipo: 'cambio', causa: 'sellado_sin_abrir', monto: null })] });
    await expect(servicio.aprobar(20, 'est-1', { metodoReembolso: 'efectivo' })).rejects.toBeInstanceOf(BadRequestException);
    await servicio.aprobar(20, 'est-1', {});
    expect(prisma.devolucion.updateMany.mock.calls[0][0].data.metodoReembolso).toBeNull();
  });

  it('aprobar o rechazar algo ya resuelto responde 409 y no saca efectivo', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud({ estado: 'rechazada' })], updateCount: 0 });
    await expect(servicio.aprobar(20, 'est-1', { metodoReembolso: 'efectivo' })).rejects.toBeInstanceOf(ConflictException);
    await expect(servicio.rechazar(20, 'est-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
  });

  it('rechazar guarda quién, cuándo y la nota', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()] });
    await servicio.rechazar(20, 'adm-1', { nota: 'Producto abierto' });
    expect(prisma.devolucion.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 20, estado: 'pendiente' }, data: { estado: 'rechazada', resueltoPorId: 'adm-1', notaResolucion: 'Producto abierto' } });
  });

  it('una solicitud que no existe responde 404', async () => {
    const { servicio } = montar();
    await expect(servicio.aprobar(99, 'est-1', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Guards con las claves de producción', () => {
  async function pasa(Guard: typeof PermisosGuard | typeof RolesGuard, metodo: string, rol: string) {
    const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
    const guard = new Guard(new Reflector(), prisma);
    const ctx: any = { getHandler: () => (DevolucionesController.prototype as any)[metodo], getClass: () => DevolucionesController, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }) };
    try { return await guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  }

  it.each(['aprobar', 'rechazar'])('%s: la clienta y el empleado no; la estilista y el admin sí', async (metodo) => {
    expect(await pasa(PermisosGuard, metodo, 'cliente')).toBe(false);
    expect(await pasa(PermisosGuard, metodo, 'empleado')).toBe(false);
    expect(await pasa(PermisosGuard, metodo, 'estilista')).toBe(true);
    expect(await pasa(PermisosGuard, metodo, 'admin')).toBe(true);
  });

  it('borrar es solo del admin', async () => {
    expect(await pasa(RolesGuard, 'eliminar', 'cliente')).toBe(false);
    expect(await pasa(RolesGuard, 'eliminar', 'estilista')).toBe(false);
    expect(await pasa(RolesGuard, 'eliminar', 'admin')).toBe(true);
  });

  it('ya no hay PUT /devoluciones/:id', () => {
    expect((DevolucionesController.prototype as any).actualizar).toBeUndefined();
  });

  it('cancelar y crear no exigen la clave (la clienta las usa)', async () => {
    expect(await pasa(PermisosGuard, 'cancelar', 'cliente')).toBe(true);
    expect(await pasa(PermisosGuard, 'crear', 'cliente')).toBe(true);
  });
});

describe('Lecturas', () => {
  it('la dueña ve la suya; otra clienta recibe 404; la estilista la ve desde el panel pero no con propios', async () => {
    const { servicio } = montar({ devoluciones: [solicitud()] });
    await expect(servicio.obtenerPorId(20, 'cli-1')).resolves.toMatchObject({ success: true });
    await expect(servicio.obtenerPorId(20, 'cli-2')).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.obtenerPorId(20, 'est-1')).resolves.toMatchObject({ success: true });
    await expect(servicio.obtenerPorId(20, 'est-1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('por pedido: la clienta no lista las de un pedido ajeno', async () => {
    const { servicio, prisma } = montar();
    await expect(servicio.listarPorPedido(10, 'cli-1')).rejects.toBeInstanceOf(NotFoundException);
    await servicio.listarPorPedido(9, 'cli-1');
    expect(prisma.devolucion.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('GET /devoluciones paginado', () => {
  it('con la clave: un solo findMany con include y skip/take, más el count, en una transacción', async () => {
    const { servicio, prisma } = montar();
    prisma.devolucion.findMany.mockResolvedValueOnce([{ id: 1 }]);
    prisma.devolucion.count.mockResolvedValueOnce(45);
    const r = await servicio.listar('est-1', { page: 3, limit: 20, estado: 'pendiente' });
    expect(prisma.devolucion.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.devolucion.findMany.mock.calls[0][0];
    expect(arg).toMatchObject({ skip: 40, take: 20, where: { estado: 'pendiente' } });
    expect(arg.include.pedido.select.usuario.select).toMatchObject({ nombre: true, email: true });
    expect(arg.include.pedidoItem).toBeDefined();
    expect(arg.include.resueltoPor.select).toMatchObject({ nombre: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ success: true, data: [{ id: 1 }], count: 45, page: 3, limit: 20, totalPages: 3 });
  });

  it('con propios=true devuelve solo las de quien consulta', async () => {
    const { servicio, prisma } = montar();
    await servicio.listar('est-1', { page: 1, limit: 20, propios: true });
    expect(prisma.devolucion.findMany.mock.calls[0][0].where).toEqual({ pedido: { usuarioId: 'est-1' } });
  });

  it('la clienta sin propios recibe 403', async () => {
    const { servicio, prisma } = montar();
    await expect(servicio.listar('cli-1', { page: 1, limit: 20 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.devolucion.findMany).not.toHaveBeenCalled();
  });

  it('un estado desconocido responde 400', async () => {
    const { servicio } = montar();
    await expect(servicio.listar('adm-1', { page: 1, limit: 20, estado: 'lo-que-sea' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Dinero: una sola devolución activa por artículo y nunca más que el pedido', () => {
  const activa = (extra: Record<string, unknown>) => ({ id: 30, pedidoId: 9, pedidoItemId: 3, estado: 'pendiente', tipo: 'reembolso', monto: '120.00', ...extra });
  const reembolsoItem = { pedidoId: 9, pedidoItemId: 3, tipo: 'reembolso', causa: 'defecto_fabrica' };

  it('si ya hay una pendiente del mismo artículo, crear responde 409', async () => {
    const { servicio, prisma } = montar({ devoluciones: [activa({})] });
    await expect(servicio.crear('cli-1', reembolsoItem as any)).rejects.toThrow('Ya hay una solicitud activa para este artículo o pedido');
    expect(prisma.devolucion.create).not.toHaveBeenCalled();
  });

  it('si ya hay una aprobada del pedido completo, no se pide otra de un artículo (409)', async () => {
    const { servicio } = montar({ devoluciones: [activa({ pedidoItemId: null, estado: 'aprobada' })] });
    await expect(servicio.crear('cli-1', reembolsoItem as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('una del pedido completo choca con cualquier artículo activo (409)', async () => {
    const pedidos = [pedidoDe(9, 'cli-1', { estado: 'cancelado', historialEstado: [] })];
    const { servicio } = montar({ pedidos, devoluciones: [activa({ pedidoItemId: 8, estado: 'aprobada' })] });
    await expect(servicio.crear('cli-1', { pedidoId: 9, tipo: 'reembolso', causa: 'sin_existencias' } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('las rechazadas o canceladas, o las de otro artículo, no bloquean', async () => {
    const { servicio, prisma } = montar({ devoluciones: [activa({ estado: 'rechazada' }), activa({ id: 31, estado: 'cancelada' }), activa({ id: 32, pedidoItemId: 6 })] });
    await servicio.crear('cli-1', reembolsoItem as any);
    expect(prisma.devolucion.create).toHaveBeenCalledTimes(1);
  });

  it('aprobar no deja que los reembolsos aprobados superen el total del pedido (409, sin salida de caja)', async () => {
    const previa = { id: 40, pedidoId: 9, pedidoItemId: null, estado: 'aprobada', tipo: 'reembolso', monto: '400.00' };
    const { servicio, prisma } = montar({ devoluciones: [previa, solicitud()] });
    await expect(servicio.aprobar(20, 'est-1', { metodoReembolso: 'efectivo' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.devolucion.updateMany).not.toHaveBeenCalled();
    expect(prisma.movimientoCaja.create).not.toHaveBeenCalled();
  });

  it('hasta el total del pedido sí se aprueba', async () => {
    const previa = { id: 40, pedidoId: 9, pedidoItemId: 4, estado: 'aprobada', tipo: 'reembolso', monto: '330.00' };
    const { servicio, prisma } = montar({ devoluciones: [previa, solicitud()] });
    await servicio.aprobar(20, 'est-1', {});
    expect(prisma.devolucion.updateMany).toHaveBeenCalledTimes(1);
  });

  it('si un pago del pedido ya se reembolsó, aprobar un reembolso responde 409', async () => {
    const { servicio, prisma } = montar({ devoluciones: [solicitud()], pagos: [{ id: 7, pedidoId: 9, estado: 'reembolsado' }] });
    await expect(servicio.aprobar(20, 'est-1', {})).rejects.toThrow('El pago del pedido ya se reembolsó');
    expect(prisma.devolucion.updateMany).not.toHaveBeenCalled();
  });
});
