import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/**
 * Anular una venta que YA entró a un corte (cancelarVenta la rechaza con 409): la venta pasa a
 * cancelada UNA sola vez (updateMany condicional), el stock regresa y se registra una salida de
 * efectivo por el total, con el folio y el motivo. No hay cortes "abiertos" (el corte se guarda al
 * cerrar caja y toma lo que esa persona tiene sin cortar): la salida queda sin corte a nombre de quien
 * anula y la toma su siguiente corte. Por eso solo anula quien opera la caja (caja:escritura, la clave
 * de POST /pos/cortes); si no, 409 y nada cambia.
 */
const CLAVES_ROL: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['ventas:escritura', 'caja:escritura', 'devoluciones:gestionar'],
  // Un rol con devoluciones:gestionar pero sin caja (no hace cortes).
  gerente_sin_caja: ['devoluciones:gestionar', 'ventas:escritura'],
};
const ROL_DE: Record<string, string> = { 'gerente-1': 'estilista', 'gerente-2': 'estilista', 'admin-1': 'admin', 'sin-caja': 'gerente_sin_caja' };
const d = (n: number) => new Prisma.Decimal(n);
const HOY = new Date('2026-10-14T17:00:00.000Z'); // 14 oct 11:00 en México
const AYER = new Date('2026-10-13T17:00:00.000Z');

/** Filtro mínimo de Prisma: igualdad, null, Date, OR, in, not/isNot, gte y lte. */
function coincide(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return (cond as any[]).some((w) => coincide(fila, w));
    const v = fila[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond !== 'object') return v === cond;
    return Object.entries(cond).every(([op, x]: [string, any]) => {
      const t = (z: any) => (z instanceof Date ? z.getTime() : z);
      switch (op) {
        case 'in': return (x as any[]).includes(v);
        case 'not':
        case 'isNot': return x === null ? v !== null && v !== undefined : v !== x;
        case 'gte': return v != null && t(v) >= t(x);
        case 'lte': return v != null && t(v) <= t(x);
        default: throw new Error(`Operador no soportado en la prueba: ${op}`);
      }
    });
  });
}

/** Venta del día de quien anula, todavía sin cortar (entra a su siguiente corte). */
const ventaAbierta = (extra: Record<string, unknown> = {}) => ({
  id: 50, folio: 'VL-2026-000050', estado: 'pagada', corteId: null, cajeroId: 'gerente-1', metodoPago: 'efectivo',
  total: d(100), montoEfectivo: null, montoTarjeta: null, montoTransferencia: null, creadoEn: HOY, items: [], ...extra,
});

function montarAnulacion(
  extra: Record<string, unknown> = {},
  opts: { ventas?: any[]; pagos?: any[]; movimientos?: any[] } = {},
) {
  const venta: any = {
    id: 9,
    folio: 'VL-2026-000009',
    estado: 'pagada',
    corteId: 4,
    cajeroId: 'cajera-1',
    metodoPago: 'efectivo',
    total: d(450),
    creadoEn: AYER,
    items: [{ presentacionId: 3, cantidad: 2, citaId: null }],
    ...extra,
  };
  const ventas: any[] = [venta, ...(opts.ventas ?? [ventaAbierta()])];
  const pagos: any[] = opts.pagos ?? [];
  const movimientos: any[] = opts.movimientos ?? [];
  const cortes: any[] = [];
  const actualizar = (filas: any[], where: any, data: any) => {
    const r = filas.filter((f) => coincide(f, where));
    r.forEach((f) => Object.assign(f, data));
    return { count: r.length };
  };
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES_ROL[where.rol] ? { claves: CLAVES_ROL[where.rol] } : null)) },
    ventaLocal: {
      // Cada lectura es una foto del momento, como en la base.
      findUnique: jest.fn(async ({ where }: any) => {
        const v = ventas.find((x) => x.id === where.id);
        return v ? { ...v } : null;
      }),
      findMany: jest.fn(async ({ where }: any) => ventas.filter((v) => coincide(v, where))),
      count: jest.fn(async ({ where }: any) => ventas.filter((v) => coincide(v, where)).length),
      // El cambio de estado condicional se comporta como en la base: { not: null } exige corte.
      updateMany: jest.fn(async ({ where, data }: any) => actualizar(ventas, where, data)),
    },
    ventaLocalItem: { updateMany: jest.fn(async () => ({ count: 0 })) },
    pago: {
      findMany: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where))),
      count: jest.fn(async ({ where }: any) => pagos.filter((p) => coincide(p, where)).length),
      updateMany: jest.fn(async ({ where, data }: any) => actualizar(pagos, where, data)),
    },
    movimientoCaja: {
      create: jest.fn(async ({ data }: any) => {
        const m = { id: movimientos.length + 1, corteId: null, creadoEn: new Date(), ...data };
        movimientos.push(m);
        return m;
      }),
      findMany: jest.fn(async ({ where }: any) => movimientos.filter((m) => coincide(m, where))),
      count: jest.fn(async ({ where }: any) => movimientos.filter((m) => coincide(m, where)).length),
      updateMany: jest.fn(async ({ where, data }: any) => actualizar(movimientos, where, data)),
    },
    corteCaja: {
      create: jest.fn(async ({ data }: any) => {
        const c = { id: 100 + cortes.length, ...data };
        cortes.push(c);
        return c;
      }),
    },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const inventario = { registrarEntrada: jest.fn(async () => ({})) };
  const pos = new PosService(prisma, inventario as any, { emit: jest.fn() } as any);
  return { pos, venta, ventas, movimientos, cortes, inventario, prisma };
}

const motivo = { motivoCancelacion: 'Cobro duplicado del día anterior' } as any;
const MENSAJE_SIN_CAJA = 'Para anular necesitas operar la caja: pide a quien hace el corte que registre la anulación.';

describe('Anular venta cortada: salida de efectivo con motivo y folio', () => {
  beforeEach(() => jest.useFakeTimers({ now: HOY }));
  afterEach(() => jest.useRealTimers());

  it('cancela la venta, devuelve el stock y registra la salida por el total', async () => {
    const { pos, venta, movimientos, inventario } = montarAnulacion();
    await expect(pos.anularVentaCortada(9, motivo, 'gerente-1')).resolves.toMatchObject({
      success: true,
      data: { estado: 'cancelada' },
    });
    expect(venta).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'Cobro duplicado del día anterior' });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ tipo: 'salida', registradoPorId: 'gerente-1', pagoId: null, devolucionId: null });
    expect(Number(movimientos[0].monto)).toBe(450);
    // El motivo rastrea la venta: folio + motivo capturado.
    expect(movimientos[0].motivo).toContain('VL-2026-000009');
    expect(movimientos[0].motivo).toContain('Cobro duplicado del día anterior');
    expect(inventario.registrarEntrada).toHaveBeenCalledWith(
      expect.objectContaining({ presentacionId: 3, cantidad: 2 }),
      'gerente-1',
      expect.anything(),
    );
  });

  it('la salida queda sin corte a nombre de quien anula y la toma su siguiente corte: lleva su corteId y la caja cuadra', async () => {
    const { pos, movimientos, cortes, ventas } = montarAnulacion();
    await pos.anularVentaCortada(9, motivo, 'gerente-1');
    expect(movimientos[0]).toMatchObject({ registradoPorId: 'gerente-1', corteId: null });

    // Su caja de hoy: 1000 de fondo + 100 de su venta en efectivo − 450 de la anulación = 650.
    await pos.crearCorte({ fecha: '2026-10-14', efectivoInicial: 1000, efectivoFinal: 650 } as any, 'gerente-1');

    expect(cortes).toHaveLength(1);
    expect(movimientos[0].corteId).toBe(cortes[0].id);
    expect(Number(cortes[0].totalSalidas)).toBe(450);
    expect(Number(cortes[0].diferencia)).toBe(0);
    expect(ventas.find((v) => v.id === 50).corteId).toBe(cortes[0].id);
  });

  it('sin nada cobrado hoy también puede anular (no existen cortes "abiertos"): la toma su siguiente corte', async () => {
    const { pos, venta, movimientos } = montarAnulacion({}, { ventas: [] });
    await pos.anularVentaCortada(9, motivo, 'gerente-1');
    expect(venta.estado).toBe('cancelada');
    expect(movimientos).toEqual([expect.objectContaining({ registradoPorId: 'gerente-1', corteId: null })]);
  });

  it('el admin (todas las claves) opera la caja y puede anular', async () => {
    const { pos, venta, movimientos } = montarAnulacion();
    await pos.anularVentaCortada(9, motivo, 'admin-1');
    expect(venta.estado).toBe('cancelada');
    expect(movimientos).toEqual([expect.objectContaining({ registradoPorId: 'admin-1' })]);
  });

  it.each([
    ['tiene devoluciones:gestionar pero no caja:escritura', 'sin-caja'],
    ['no existe', 'fantasma'],
  ])('quien anula no opera la caja (%s): 409 y no cambia nada (ni venta, ni stock, ni caja)', async (_n, usuarioId) => {
    const { pos, venta, movimientos, inventario, prisma } = montarAnulacion();
    await expect(pos.anularVentaCortada(9, motivo, usuarioId)).rejects.toMatchObject({ status: 409, message: MENSAJE_SIN_CAJA });
    expect(venta).toMatchObject({ estado: 'pagada', corteId: 4 });
    expect(venta.motivoCancelacion).toBeUndefined();
    expect(movimientos).toHaveLength(0);
    expect(inventario.registrarEntrada).not.toHaveBeenCalled();
    expect(prisma.ventaLocalItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('con total $0 (lo cubrió el anticipo) no sale efectivo: se anula sin salida de caja', async () => {
    const { pos, venta, movimientos } = montarAnulacion({ total: d(0) });
    await pos.anularVentaCortada(9, motivo, 'gerente-1');
    expect(venta.estado).toBe('cancelada');
    expect(movimientos).toHaveLength(0);
  });

  it('dos anulaciones simultáneas: una sola devuelve stock y registra la salida; la otra 409', async () => {
    // Las dos personas operan la caja: solo la transición condicional las separa.
    const { pos, venta, movimientos, inventario } = montarAnulacion();
    const resultados = await Promise.allSettled([
      pos.anularVentaCortada(9, motivo, 'gerente-1'),
      pos.anularVentaCortada(9, motivo, 'gerente-2'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toBeInstanceOf(ConflictException);
    expect(inventario.registrarEntrada).toHaveBeenCalledTimes(1);
    expect(movimientos).toHaveLength(1);
    expect(venta.estado).toBe('cancelada');
  });

  it('una venta sin corte responde 409: que usen la cancelación normal', async () => {
    const { pos, venta, movimientos, inventario } = montarAnulacion({ corteId: null });
    const r = pos.anularVentaCortada(9, motivo, 'gerente-1');
    await expect(r).rejects.toBeInstanceOf(ConflictException);
    await expect(pos.anularVentaCortada(9, motivo, 'gerente-1')).rejects.toThrow('cancelación normal');
    expect(venta.estado).toBe('pagada');
    expect(movimientos).toHaveLength(0);
    expect(inventario.registrarEntrada).not.toHaveBeenCalled();
  });

  it.each(['tarjeta', 'transferencia', 'mixto'])(
    'una venta cobrada con %s se rechaza: la salida de caja solo aplica a efectivo',
    async (metodoPago) => {
      const { pos, venta, movimientos, inventario } = montarAnulacion({ metodoPago });
      await expect(pos.anularVentaCortada(9, motivo, 'gerente-1')).rejects.toMatchObject({ status: 400 });
      await expect(pos.anularVentaCortada(9, motivo, 'gerente-1')).rejects.toThrow('efectivo');
      expect(venta.estado).toBe('pagada');
      expect(movimientos).toHaveLength(0);
      expect(inventario.registrarEntrada).not.toHaveBeenCalled();
    },
  );

  it('una venta ya cancelada responde 400 sin tocar caja ni stock', async () => {
    const { pos, movimientos, inventario } = montarAnulacion({ estado: 'cancelada' });
    await expect(pos.anularVentaCortada(9, motivo, 'gerente-1')).rejects.toMatchObject({ status: 400 });
    expect(movimientos).toHaveLength(0);
    expect(inventario.registrarEntrada).not.toHaveBeenCalled();
  });
});

describe('PATCH /pos/ventas/:id/anular exige devoluciones:gestionar (guard real)', () => {
  const CLAVES: Record<string, string[]> = {
    admin: ['*'],
    estilista: ['ventas:escritura', 'caja:escritura', 'devoluciones:gestionar'],
    empleado: ['ventas:escritura', 'citas:escritura'],
    cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
  };

  async function pasa(rol: string) {
    const prisma: any = {
      usuario: { findUnique: async () => ({ rol }) },
      permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) },
    };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = {
      getHandler: () => (PosController.prototype as any).anularVentaCortada,
      getClass: () => PosController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }),
    };
    try {
      return await guard.canActivate(ctx);
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
  }

  it('sin la clave (empleado, cliente) responde 403; la estilista y el admin pasan', async () => {
    expect(await pasa('empleado')).toBe(false);
    expect(await pasa('cliente')).toBe(false);
    expect(await pasa('estilista')).toBe(true);
    expect(await pasa('admin')).toBe(true);
  });

  it('cancelar sigue con ventas:escritura (el empleado cancela ventas sin corte)', async () => {
    const prisma: any = {
      usuario: { findUnique: async () => ({ rol: 'empleado' }) },
      permisoRol: { findUnique: async () => ({ claves: CLAVES.empleado }) },
    };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = {
      getHandler: () => (PosController.prototype as any).cancelarVenta,
      getClass: () => PosController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }),
    };
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
