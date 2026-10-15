import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EstadoPedido, Prisma } from '@prisma/client';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { incrementarStockPorLineas } from '../common/pedido-inventario.util';
import { DevolucionesController } from '../devoluciones/devoluciones.controller';
import { DevolucionesService } from '../devoluciones/devoluciones.service';
import { RevocarPedidoDto } from './dto/revocar-pedido.dto';
import { PedidosService } from './pedidos.service';

jest.mock('../common/pedido-inventario.util', () => ({
  cantidadPorPresentacion: jest.fn(() => new Map()),
  decrementarStockPresentaciones: jest.fn(async () => undefined),
  incrementarStockPorLineas: jest.fn(async () => undefined),
}));
const stock = jest.mocked(incrementarStockPorLineas);

/**
 * Revocación de compra (art. 56 de la Ley Federal de Protección al Consumidor), punta a punta sobre una base
 * en memoria con PedidosService y DevolucionesService reales; Mercado Pago simulado.
 *
 * Calendario (noviembre de 2026): entrega o pago el jueves 12 a las 17:00 de México.
 *   vie 13 (1), sáb 14 (2), dom 15 no, lun 16 festivo, mar 17 (3), mié 18 (4), jue 19 (5): vence el jueves 19
 *   a las 23:59:59.999 de México; el viernes 20 es el día 6.
 */
const CLIENTA = 'cliente-yo';
const OTRA = 'otra-clienta';
const ESTILISTA = 'estilista-yo';
const EVENTO = new Date('2026-11-12T17:00:00-06:00');
const DIA_5 = new Date('2026-11-19T22:00:00-06:00');
const DIA_6 = new Date('2026-11-20T09:00:00-06:00');
const VENCE = new Date('2026-11-19T23:59:59.999-06:00');
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'caja:escritura', 'pedidos:entregar', 'devoluciones:gestionar'],
  empleado: ['ventas:escritura', 'citas:escritura', 'pedidos:entregar'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};

/** Filtro mínimo de Prisma: igualdad, null, { in }, { notIn }, { not } y OR. */
function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => coincide(fila, w));
    if (v === null) return fila[k] == null;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(fila[k]);
      if ('notIn' in v) return !v.notIn.includes(fila[k]);
      if ('not' in v) return v.not === null ? fila[k] != null : fila[k] !== v.not;
    }
    return (fila[k] ?? null) === v;
  });
}

const pagoMp = (extra: Record<string, unknown> = {}) => ({
  id: 31, pedidoId: 7, estado: 'aprobado', metodo: 'mercado_pago', proveedor: 'mercadopago', referenciaExterna: '987654', monto: new Prisma.Decimal(350), cobradoPorId: null, ...extra,
});
const pagoEfectivo = (extra: Record<string, unknown> = {}) => ({
  id: 32, pedidoId: 7, estado: 'aprobado', metodo: 'efectivo', proveedor: null, referenciaExterna: null, monto: new Prisma.Decimal(350), cobradoPorId: ESTILISTA, ...extra,
});

function montar(opts: { pedido?: Record<string, unknown>; pagos?: any[]; devoluciones?: any[]; historial?: any[]; items?: any[]; concurrente?: boolean } = {}) {
  const entregado = (opts.pedido?.estado ?? EstadoPedido.entregado) === EstadoPedido.entregado;
  const db = {
    pedidos: [
      { id: 7, usuarioId: CLIENTA, estado: EstadoPedido.entregado, metodoPago: 'mercado_pago', total: new Prisma.Decimal(350), moneda: 'MXN', pagadoEn: EVENTO, ...opts.pedido },
      { id: 8, usuarioId: OTRA, estado: EstadoPedido.entregado, metodoPago: 'mercado_pago', total: new Prisma.Decimal(90), moneda: 'MXN', pagadoEn: EVENTO },
    ] as any[],
    items: (opts.items ?? [{ id: 1, pedidoId: 7, presentacionId: 3, cantidad: 2, subtotal: new Prisma.Decimal(350) }]) as any[],
    historial: (opts.historial ?? (entregado ? [{ id: 1, pedidoId: 7, estadoNuevo: 'entregado', creadoEn: EVENTO }] : [])) as any[],
    pagos: (opts.pagos ?? [pagoMp()]) as any[],
    devoluciones: (opts.devoluciones ?? []) as any[],
    movimientosCaja: [] as any[],
  };
  let sigDevolucion = 100;

  const relacionesPedido = (p: any, inc: any) => {
    if (!p) return null;
    const r: any = { ...p };
    for (const [k, v] of Object.entries<any>(inc ?? {})) {
      if (k === 'items') r.items = db.items.filter((i) => i.pedidoId === p.id);
      if (k === 'usuario') r.usuario = { id: p.usuarioId, nombre: 'Ana López', email: 'ana@correo.mx' };
      if (k === 'historialEstado') {
        let h = db.historial.filter((x) => x.pedidoId === p.id && coincide(x, v?.where));
        h = h.sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
        r.historialEstado = v?.take ? h.slice(0, v.take) : h;
      }
      if (k === 'devoluciones') {
        const d = db.devoluciones.filter((x) => x.pedidoId === p.id && coincide(x, v?.where));
        r.devoluciones = v?.take ? d.slice(0, v.take) : d;
      }
    }
    return r;
  };
  const relacionesDevolucion = (d: any, inc: any) => {
    if (!d) return null;
    const r: any = { ...d };
    if (inc?.pedido) r.pedido = relacionesPedido(db.pedidos.find((p) => p.id === d.pedidoId), { usuario: true });
    return r;
  };

  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    pedido: {
      findUnique: jest.fn(async ({ where, include, select }: any) => relacionesPedido(db.pedidos.find((p) => p.id === where.id), include ?? select)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const filas = db.pedidos.filter((p) => coincide(p, where));
        filas.forEach((p) => Object.assign(p, data));
        return { count: filas.length };
      }),
    },
    historialEstadoPedido: { create: jest.fn(async ({ data }: any) => { db.historial.push({ id: db.historial.length + 1, creadoEn: new Date(), ...data }); return data; }) },
    devolucion: {
      findUnique: jest.fn(async ({ where, include, select }: any) => relacionesDevolucion(db.devoluciones.find((d) => d.id === where.id), include ?? select)),
      findFirst: jest.fn(async ({ where }: any) => db.devoluciones.find((d) => coincide(d, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => db.devoluciones.filter((d) => coincide(d, where))),
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: sigDevolucion++, origen: 'solicitud', estado: 'pendiente', pedidoItemId: null, pagoId: null, causa: null, creadoEn: new Date(), ...data };
        db.devoluciones.push(fila);
        return fila;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const filas = db.devoluciones.filter((d) => coincide(d, where));
        filas.forEach((d) => Object.assign(d, data));
        return { count: filas.length };
      }),
    },
    pago: {
      findFirst: jest.fn(async ({ where }: any) => db.pagos.filter((p) => coincide(p, where)).sort((a, b) => b.id - a.id)[0] ?? null),
      findMany: jest.fn(async ({ where }: any) => db.pagos.filter((p) => coincide(p, where)).sort((a, b) => b.id - a.id)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const filas = db.pagos.filter((p) => coincide(p, where));
        filas.forEach((p) => Object.assign(p, data));
        return { count: filas.length };
      }),
    },
    movimientoCaja: { create: jest.fn(async ({ data }: any) => { db.movimientosCaja.push(data); return data; }) },
  };
  // Las transacciones se forman en fila, como con el candado pg_advisory_xact_lock de reembolsos del pedido.
  let fila: Promise<unknown> = Promise.resolve();
  const prisma: any = {
    ...tx,
    $transaction: jest.fn((fn: (t: any) => Promise<unknown>) => {
      const r = fila.then(() => fn(tx));
      fila = r.catch(() => undefined);
      return r;
    }),
  };
  // Con `concurrente`, las transacciones corren a la vez de verdad: solo el candado las ordena. Se simula
  // pg_advisory_xact_lock: quien pide la misma clave espera a que termine la transacción que la tiene.
  const candados = new Map<string, Promise<void>>();
  const candadosTomados: string[] = [];
  if (opts.concurrente) {
    prisma.$transaction = jest.fn(async (fn: (t: any) => Promise<unknown>) => {
      const soltar: (() => void)[] = [];
      const t = {
        ...tx,
        $executeRaw: jest.fn(async (_sql: TemplateStringsArray, clave: string) => {
          const previo = candados.get(clave) ?? Promise.resolve();
          const propio = new Promise<void>((r) => soltar.push(r));
          candados.set(clave, previo.then(() => propio));
          await previo;
          candadosTomados.push(clave);
          return 1;
        }),
      };
      try {
        return await fn(t);
      } finally {
        soltar.forEach((s) => s());
      }
    });
  }
  const access = { getRol: jest.fn(async (id: string) => (id.startsWith('estilista') ? 'estilista' : 'cliente')), isAdmin: () => false };
  const eventos = { emit: jest.fn() };
  const mercadoPago = {
    reembolsarPago: jest.fn(async () => ({ id: 1, status: 'approved' })),
    obtenerPago: jest.fn(async () => ({ id: 987654, status: 'approved' })),
  };
  const devoluciones = new DevolucionesService(prisma, mercadoPago as any);
  const pedidos = new PedidosService(prisma, access as any, eventos as any, mercadoPago as any, devoluciones);
  return { db, pedidos, devoluciones, mercadoPago, eventos, prisma, candadosTomados };
}

beforeEach(() => jest.clearAllMocks());

describe('Detalle del pedido en el portal: revocableHasta y puedeRevocar los calcula el backend', () => {
  it('entregado: el plazo corre desde la entrega del historial; el día 5 se puede, el día 6 no', async () => {
    const { pedidos } = montar({ pedido: { pagadoEn: new Date('2026-11-02T12:00:00-06:00') } });
    const dia5 = await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5);
    expect(dia5.data).toMatchObject({ revocableHasta: VENCE, puedeRevocar: true });
    const dia6 = await pedidos.obtenerPorId(7, CLIENTA, true, DIA_6);
    expect(dia6.data).toMatchObject({ revocableHasta: VENCE, puedeRevocar: false });
    // Lo auxiliar de la consulta no sale en la respuesta.
    expect(dia5.data).not.toHaveProperty('historialEstado');
    expect(dia5.data).not.toHaveProperty('devoluciones');
  });

  it('sin entregar: corre desde el pago', async () => {
    const { pedidos } = montar({ pedido: { estado: EstadoPedido.preparando } });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ revocableHasta: VENCE, puedeRevocar: true });
  });

  it('ya revocado (revocación pendiente): puedeRevocar false', async () => {
    const { pedidos } = montar({ devoluciones: [{ id: 50, pedidoId: 7, estado: 'pendiente', origen: 'revocacion_art56' }] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: false });
  });

  it('una revocación cancelada por la clienta no cuenta: puede volver a revocar dentro del plazo', async () => {
    const { pedidos } = montar({ devoluciones: [{ id: 50, pedidoId: 7, estado: 'cancelada', origen: 'revocacion_art56' }] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: true });
  });

  it('cancelado o sin pagar: sin fecha y sin botón', async () => {
    const cancelado = montar({ pedido: { estado: EstadoPedido.cancelado } });
    expect((await cancelado.pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ revocableHasta: null, puedeRevocar: false });
    const apartado = montar({ pedido: { estado: EstadoPedido.preparando, metodoPago: 'pago_en_salon', pagadoEn: null } });
    expect((await apartado.pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ revocableHasta: null, puedeRevocar: false });
  });

  it('el panel (sin propios) responde igual que antes, sin los campos nuevos', async () => {
    const { pedidos } = montar();
    const r = await pedidos.obtenerPorId(7, CLIENTA, false, DIA_5);
    expect(r.data).not.toHaveProperty('puedeRevocar');
    expect(r.data).not.toHaveProperty('revocableHasta');
    expect(r.data).not.toHaveProperty('montoRevocable');
  });

  // El botón solo se ofrece si revocar procedería: mismas reglas que POST /pedidos/:id/revocar.
  const reembolso = (estado: string, monto: number, extra: Record<string, unknown> = {}) => ({
    id: 60, pedidoId: 7, estado, tipo: 'reembolso', origen: 'solicitud', monto: new Prisma.Decimal(monto), pedidoItemId: 1, ...extra,
  });

  it('sin devoluciones: puede revocar por el total', async () => {
    const { pedidos } = montar();
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: true, montoRevocable: 350 });
  });

  it('con un reembolso parcial aprobado: puede revocar y el monto es el saldo (350 - 150 = 200)', async () => {
    const { pedidos } = montar({ devoluciones: [reembolso('aprobada', 150)] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: true, montoRevocable: 200 });
  });

  it('un reembolso rechazado o cancelado no descuenta del saldo', async () => {
    for (const estado of ['rechazada', 'cancelada']) {
      const { pedidos } = montar({ devoluciones: [reembolso(estado, 150)] });
      expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: true, montoRevocable: 350 });
    }
  });

  it('con todo reembolsado por devoluciones aprobadas: sin botón y saldo 0', async () => {
    const { pedidos } = montar({ devoluciones: [reembolso('aprobada', 350)] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: false, montoRevocable: 0 });
  });

  it('con una devolución normal pendiente: sin botón (revocar respondería 409)', async () => {
    const { pedidos } = montar({ devoluciones: [reembolso('pendiente', 150)] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: false });
  });

  it('con el pago ya reembolsado: sin botón', async () => {
    const { pedidos } = montar({ pagos: [pagoMp({ estado: 'reembolsado' })] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: false });
  });

  it('el monto revocable nunca pasa de lo cobrado: si el pago es menor que el total, es el pago (mismo tope que revocar)', async () => {
    const { pedidos } = montar({ pagos: [pagoMp({ monto: new Prisma.Decimal(300) })] });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: true, montoRevocable: 300 });
  });

  it('enviado (estado heredado): el plazo corre desde el enviado del historial, como en revocar', async () => {
    const { pedidos } = montar({
      pedido: { estado: EstadoPedido.enviado, pagadoEn: new Date('2026-11-02T12:00:00-06:00') },
      historial: [{ id: 1, pedidoId: 7, estadoNuevo: 'enviado', creadoEn: EVENTO }],
    });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ revocableHasta: VENCE, puedeRevocar: true, montoRevocable: 350 });
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_6)).data).toMatchObject({ revocableHasta: VENCE, puedeRevocar: false });
  });
});

describe('POST /pedidos/:id/revocar: plazo, dueña y una sola vez', () => {
  it('el día 5 hábil (con domingo y festivo en medio, sábado contado) se permite', async () => {
    const { pedidos, db } = montar();
    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion).toMatchObject({ estado: 'pendiente_entrega', monto: 350 });
    expect(db.devoluciones).toHaveLength(1);
  });

  it('el día 6 hábil responde 409 con la fecha en que terminó, y no crea nada', async () => {
    const { pedidos, db, mercadoPago } = montar();
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_6)).rejects.toMatchObject({
      status: 409,
      message: 'El plazo para revocar tu compra terminó el jueves, 19 de noviembre de 2026. Si tienes un problema con tu pedido, comunícate con el salón.',
    });
    expect(db.devoluciones).toHaveLength(0);
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
  });

  it('el pedido de otra persona responde 404, aunque quien pida sea personal', async () => {
    const { pedidos, db } = montar();
    await expect(pedidos.revocar(8, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 404 });
    await expect(pedidos.revocar(7, ESTILISTA, undefined, DIA_5)).rejects.toMatchObject({ status: 404 });
    await expect(pedidos.revocar(999, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 404 });
    expect(db.devoluciones).toHaveLength(0);
  });

  it('ya revocado: 409 y no se crea otra devolución', async () => {
    const { pedidos, db } = montar({ devoluciones: [{ id: 50, pedidoId: 7, estado: 'pendiente', origen: 'revocacion_art56' }] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409, message: 'Ya revocaste esta compra.' });
    expect(db.devoluciones).toHaveLength(1);
  });

  it('con otra solicitud de devolución activa: 409 con qué hacer', async () => {
    const { pedidos, db } = montar({ devoluciones: [{ id: 51, pedidoId: 7, estado: 'pendiente', origen: 'solicitud' }] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409 });
    expect(db.devoluciones).toHaveLength(1);
  });

  it('si el pago ya se reembolsó: 409', async () => {
    const { pedidos, db } = montar({ pagos: [pagoMp({ estado: 'reembolsado' })] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409 });
    expect(db.devoluciones).toHaveLength(0);
  });

  it('un pedido cancelado o sin pagar no se revoca (409)', async () => {
    await expect(montar({ pedido: { estado: EstadoPedido.cancelado } }).pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409 });
    await expect(
      montar({ pedido: { estado: EstadoPedido.pendiente_pago, pagadoEn: null } }).pedidos.revocar(7, CLIENTA, undefined, DIA_5),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('el motivo es opcional y se guarda con la etiqueta de la revocación', async () => {
    const { pedidos, db } = montar();
    await pedidos.revocar(7, CLIENTA, '  Ya no lo necesito  ', DIA_5);
    expect(db.devoluciones[0].motivo).toBe('[Revocación de compra · art. 56 LFPC] Ya no lo necesito');
    const otro = montar();
    await otro.pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(otro.db.devoluciones[0].motivo).toBe('[Revocación de compra · art. 56 LFPC]');
  });

  it('el motivo pasa por el mismo saneamiento que los demás textos libres: sin caracteres nulos, y uno con inyección SQL responde 400 sin crear nada', async () => {
    const { pedidos, db } = montar();
    await pedidos.revocar(7, CLIENTA, ' Ya no\u0000 lo necesito ', DIA_5);
    expect(db.devoluciones[0].motivo).toBe('[Revocación de compra · art. 56 LFPC] Ya no lo necesito');

    const otro = montar({ pedido: { estado: EstadoPedido.preparando } });
    await expect(otro.pedidos.revocar(7, CLIENTA, "x'; DROP TABLE pedidos; --", DIA_5)).rejects.toMatchObject({
      status: 400,
      message: 'El motivo contiene caracteres no permitidos',
    });
    expect(otro.db.devoluciones).toHaveLength(0);
    expect(otro.db.pedidos[0].estado).toBe('preparando');
    expect(stock).not.toHaveBeenCalled();
  });

  it('DTO: motivo opcional de hasta 500 caracteres; nada más', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const validar = (body: Record<string, unknown>) => pipe.transform(body, { type: 'body', metatype: RevocarPedidoDto });
    await expect(validar({})).resolves.toBeInstanceOf(RevocarPedidoDto);
    await expect(validar({ motivo: 'Cambié de opinión' })).resolves.toBeInstanceOf(RevocarPedidoDto);
    await expect(validar({ motivo: 'x'.repeat(501) })).rejects.toMatchObject({ status: 400 });
    await expect(validar({ monto: 1 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('Revocar un pedido NO entregado: se cancela, se reembolsa todo y regresa el stock', () => {
  it('pagado con Mercado Pago: pedido cancelado, reembolso total con el cliente existente, stock de vuelta y devolución trazable', async () => {
    const { pedidos, db, mercadoPago, eventos } = montar({ pedido: { estado: EstadoPedido.preparando } });

    const r = await pedidos.revocar(7, CLIENTA, 'Ya no lo quiero', DIA_5);

    expect(db.pedidos[0].estado).toBe('cancelado');
    expect(db.historial.at(-1)).toMatchObject({ estadoAnterior: 'preparando', estadoNuevo: 'cancelado', origen: 'api.revocar_clienta' });
    expect(stock).toHaveBeenCalledTimes(1);
    expect(stock.mock.calls[0][1]).toEqual([expect.objectContaining({ presentacionId: 3, cantidad: 2 })]);
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledTimes(1);
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(db.pagos[0]).toMatchObject({ estado: 'reembolsado' });
    expect(db.pagos[0].reembolsadoEn).toBeInstanceOf(Date);
    expect(db.devoluciones).toEqual([
      expect.objectContaining({ origen: 'revocacion_art56', estado: 'aprobada', tipo: 'reembolso', metodoReembolso: 'metodo_original', resueltoPorId: null }),
    ]);
    expect(Number(db.devoluciones[0].monto)).toBe(350);
    expect(r).toMatchObject({ success: true, data: { id: 7, estado: 'cancelado', puedeRevocar: false }, revocacion: { estado: 'reembolsado', monto: 350 } });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado', { pedidoId: 7, usuarioId: CLIENTA });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', expect.objectContaining({ pedidoId: 7, monto: 350, reembolso: 'reembolsado' }));
  });

  it('si Mercado Pago falla: el pedido queda cancelado con su stock, la devolución pendiente para el personal y el pago intacto', async () => {
    const { pedidos, db, mercadoPago } = montar({ pedido: { estado: EstadoPedido.pagado } });
    mercadoPago.reembolsarPago.mockRejectedValueOnce(new Error('503'));

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    expect(db.pedidos[0].estado).toBe('cancelado');
    expect(stock).toHaveBeenCalledTimes(1);
    expect(db.devoluciones[0]).toMatchObject({ origen: 'revocacion_art56', estado: 'pendiente' });
    expect(db.pagos[0].estado).toBe('aprobado');
    expect(r.revocacion).toMatchObject({ estado: 'en_revision', monto: 350 });
  });

  it('pagado en el salón en efectivo: el pedido se cancela y la devolución queda pendiente; al reembolsar, la salida de caja es de quien entrega el dinero', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = montar({ pedido: { estado: EstadoPedido.listo_recoger, metodoPago: 'efectivo' }, pagos: [pagoEfectivo()] });

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion.estado).toBe('en_revision');
    expect(db.pedidos[0].estado).toBe('cancelado');
    expect(db.movimientosCaja).toHaveLength(0);

    const rec = await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(rec.reembolso).toBe('efectivo');
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(db.movimientosCaja).toEqual([expect.objectContaining({ concepto: 'reembolso_devolucion', registradoPorId: ESTILISTA, devolucionId: r.revocacion.devolucionId })]);
    expect(String(db.movimientosCaja[0].monto)).toBe('350');
    expect(db.devoluciones[0]).toMatchObject({ estado: 'aprobada', metodoReembolso: 'efectivo', resueltoPorId: ESTILISTA });
    // El stock ya regresó al cancelar: no se suma otra vez.
    expect(stock).toHaveBeenCalledTimes(1);
    // Lo devuelto cubre el pago completo: queda reembolsado, como en la vía de Mercado Pago (los reportes no lo cuentan).
    expect(db.pagos[0]).toMatchObject({ estado: 'reembolsado' });
    expect(db.pagos[0].reembolsadoEn).toBeInstanceOf(Date);
  });

  it('doble petición simultánea: una sola devolución, un solo reembolso y el stock una sola vez', async () => {
    const { pedidos, db, mercadoPago } = montar({ pedido: { estado: EstadoPedido.pagado } });

    const [a, b] = await Promise.allSettled([pedidos.revocar(7, CLIENTA, undefined, DIA_5), pedidos.revocar(7, CLIENTA, undefined, DIA_5)]);

    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rechazo = (a.status === 'rejected' ? a : b) as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ status: 409 });
    expect(db.devoluciones).toHaveLength(1);
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledTimes(1);
    expect(stock).toHaveBeenCalledTimes(1);
  });
});

describe('Revocar un pedido YA entregado: la clienta entrega el producto y el personal reembolsa', () => {
  it('crea la devolución pendiente de recibir el producto, sin tocar el dinero ni el stock', async () => {
    const { pedidos, db, mercadoPago, eventos } = montar();

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    expect(db.pedidos[0].estado).toBe('entregado');
    expect(db.devoluciones).toEqual([expect.objectContaining({ origen: 'revocacion_art56', estado: 'pendiente', tipo: 'reembolso', pedidoItemId: null })]);
    expect(Number(db.devoluciones[0].monto)).toBe(350);
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(stock).not.toHaveBeenCalled();
    expect(db.pagos[0].estado).toBe('aprobado');
    expect(r).toMatchObject({ data: { estado: 'entregado', puedeRevocar: false }, revocacion: { estado: 'pendiente_entrega', monto: 350 } });
    expect(eventos.emit).not.toHaveBeenCalledWith('pedido.cancelado', expect.anything());
    // Aviso al personal con devoluciones:gestionar: tiene que recibir el producto y reembolsar.
    expect(eventos.emit).toHaveBeenCalledWith('pedido.revocacion_por_recibir', {
      pedidoId: 7,
      usuarioId: CLIENTA,
      devolucionId: r.revocacion.devolucionId,
      monto: 350,
    });
  });

  it('sin entregar no se avisa "por recibir" (el pedido se cancela y el producto sigue en el salón)', async () => {
    const { pedidos, eventos } = montar({ pedido: { estado: EstadoPedido.preparando } });
    await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(eventos.emit).not.toHaveBeenCalledWith('pedido.revocacion_por_recibir', expect.anything());
  });

  it('una revocación rechazada (409) no avisa a nadie', async () => {
    const { pedidos, eventos } = montar({ devoluciones: [{ id: 50, pedidoId: 7, estado: 'pendiente', origen: 'revocacion_art56' }] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409 });
    expect(eventos.emit).not.toHaveBeenCalledWith('pedido.revocacion_por_recibir', expect.anything());
  });

  it('doble petición simultánea de revocar un entregado: una sola devolución pendiente (la segunda 409)', async () => {
    const { pedidos, db } = montar();

    const r = await Promise.allSettled([pedidos.revocar(7, CLIENTA, undefined, DIA_5), pedidos.revocar(7, CLIENTA, undefined, DIA_5)]);

    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409, message: 'Ya revocaste esta compra.' });
    expect(db.devoluciones).toHaveLength(1);
  });

  it('"Recibir producto y reembolsar": reembolso total por Mercado Pago, stock de vuelta y la devolución aprobada por quien recibió', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = montar();
    const { revocacion } = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    const r = await devoluciones.recibirRevocacion(revocacion.devolucionId, ESTILISTA, { nota: 'Producto recibido sellado' });

    expect(r.reembolso).toBe('mercado_pago');
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(db.pagos[0].estado).toBe('reembolsado');
    expect(stock).toHaveBeenCalledTimes(1);
    expect(stock.mock.calls[0][2]).toMatchObject({ usuarioId: ESTILISTA, motivo: 'revocacion_compra' });
    expect(db.devoluciones[0]).toMatchObject({ estado: 'aprobada', resueltoPorId: ESTILISTA, metodoReembolso: 'metodo_original', notaResolucion: 'Producto recibido sellado' });
    expect(db.movimientosCaja).toHaveLength(0);
    // Ya revocada y reembolsada: el botón ya no aparece.
    expect((await pedidos.obtenerPorId(7, CLIENTA, true, DIA_5)).data).toMatchObject({ puedeRevocar: false });
  });

  it('dos peticiones simultáneas de recibir: un solo reembolso y el stock una sola vez; la segunda responde 409', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = montar();
    const { revocacion } = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    const resultados = await Promise.allSettled([
      devoluciones.recibirRevocacion(revocacion.devolucionId, ESTILISTA, {}),
      devoluciones.recibirRevocacion(revocacion.devolucionId, 'admin-yo', {}),
    ]);

    expect(resultados.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((resultados.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledTimes(1);
    expect(stock).toHaveBeenCalledTimes(1);
    expect(db.devoluciones.filter((d) => d.estado === 'aprobada')).toHaveLength(1);
  });

  it('pagado en el salón con tarjeta: se aprueba y se avisa que el reembolso es por el mismo medio (sin Mercado Pago ni caja)', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = montar({ pedido: { metodoPago: 'pago_en_salon' }, pagos: [pagoEfectivo({ metodo: 'tarjeta_terminal' })] });
    const { revocacion } = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    const r = await devoluciones.recibirRevocacion(revocacion.devolucionId, ESTILISTA, {});

    expect(r.reembolso).toBe('manual');
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(db.movimientosCaja).toHaveLength(0);
    expect(stock).toHaveBeenCalledTimes(1);
    expect(db.devoluciones[0]).toMatchObject({ estado: 'aprobada', metodoReembolso: 'metodo_original' });
    // Reintegrado a mano por el mismo medio y por el total: el pago queda reembolsado.
    expect(db.pagos[0]).toMatchObject({ estado: 'reembolsado' });
    expect(db.pagos[0].reembolsadoEn).toBeInstanceOf(Date);
  });

  it('si Mercado Pago falla al recibir: 503 y nada cambia (se puede reintentar)', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = montar();
    const { revocacion } = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    mercadoPago.reembolsarPago.mockRejectedValueOnce(new Error('503'));

    await expect(devoluciones.recibirRevocacion(revocacion.devolucionId, ESTILISTA, {})).rejects.toMatchObject({ status: 503 });

    expect(db.devoluciones[0].estado).toBe('pendiente');
    expect(db.pagos[0].estado).toBe('aprobado');
    expect(stock).not.toHaveBeenCalled();
    await devoluciones.recibirRevocacion(revocacion.devolucionId, ESTILISTA, {});
    expect(db.devoluciones[0].estado).toBe('aprobada');
    expect(stock).toHaveBeenCalledTimes(1);
  });

  it('las reglas de higiene de la política de cambios no aplican a la revocación (no pide sellado ni artículo)', async () => {
    const { pedidos, db } = montar();
    await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(db.devoluciones[0]).toMatchObject({ estado: 'pendiente', pedidoItemId: null });
  });
});

describe('Revocar con devoluciones normales en el pedido: solo bloquea la que está en proceso', () => {
  // Dos artículos: 200 + 150 = 350 (el total del pedido y del pago).
  const DOS_ARTICULOS = [
    { id: 1, pedidoId: 7, presentacionId: 3, cantidad: 2, subtotal: new Prisma.Decimal(200) },
    { id: 2, pedidoId: 7, presentacionId: 4, cantidad: 1, subtotal: new Prisma.Decimal(150) },
  ];
  const normal = (extra: Record<string, unknown> = {}) => ({
    id: 52, pedidoId: 7, pedidoItemId: 2, estado: 'aprobada', tipo: 'reembolso', origen: 'solicitud', monto: new Prisma.Decimal(150), metodoReembolso: 'metodo_original', ...extra,
  });

  it('con una devolución normal pendiente (sin resolver): 409 con qué hacer y no se crea nada', async () => {
    const { pedidos, db, mercadoPago } = montar({ items: DOS_ARTICULOS, devoluciones: [normal({ estado: 'pendiente' })] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({
      status: 409,
      message: 'Tienes una solicitud de devolución activa en este pedido: retírala o comunícate con el salón para revocar la compra.',
    });
    expect(db.devoluciones).toHaveLength(1);
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(stock).not.toHaveBeenCalled();
  });

  it('entregado con un reembolso parcial aprobado: procede por el saldo exacto (350 - 150 = 200) y el stock regresa solo del artículo que no se había devuelto', async () => {
    const { pedidos, devoluciones, db } = montar({ items: DOS_ARTICULOS, pedido: { metodoPago: 'efectivo' }, pagos: [pagoEfectivo()], devoluciones: [normal()] });

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion).toMatchObject({ estado: 'pendiente_entrega', monto: 200 });
    const revocacion = db.devoluciones.find((d) => d.origen === 'revocacion_art56');
    expect(String(revocacion.monto)).toBe('200');

    const rec = await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(rec.reembolso).toBe('efectivo');
    expect(db.movimientosCaja).toHaveLength(1);
    expect(String(db.movimientosCaja[0].monto)).toBe('200');
    expect(stock).toHaveBeenCalledTimes(1);
    expect(stock.mock.calls[0][1]).toEqual([expect.objectContaining({ presentacionId: 3, cantidad: 2 })]);
    // 150 de la devolución + 200 de la revocación = 350: cubre el pago, queda reembolsado.
    expect(db.pagos[0]).toMatchObject({ estado: 'reembolsado' });
  });

  it('sin entregar, pagado con Mercado Pago y un reembolso parcial aprobado: no se manda el reembolso total (sería más de lo cobrado); queda el saldo para el personal y el stock regresa sin duplicar', async () => {
    const { pedidos, devoluciones, db, mercadoPago, eventos } = montar({
      items: DOS_ARTICULOS,
      pedido: { estado: EstadoPedido.preparando },
      devoluciones: [normal({ causa: 'sin_existencias' })],
    });

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    expect(db.pedidos[0].estado).toBe('cancelado');
    expect(r.revocacion).toMatchObject({ estado: 'en_revision', monto: 200 });
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(db.pagos[0].estado).toBe('aprobado');
    expect(stock).toHaveBeenCalledTimes(1);
    expect(stock.mock.calls[0][1]).toEqual([expect.objectContaining({ presentacionId: 3, cantidad: 2 })]);
    expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado_pagado', expect.objectContaining({ pedidoId: 7, monto: 200, reembolso: 'en_revision' }));

    // El personal reintegra el saldo a mano por el mismo medio: sin Mercado Pago automático ni stock otra vez.
    const rec = await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(rec.reembolso).toBe('manual');
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(stock).toHaveBeenCalledTimes(1);
    expect(db.devoluciones.find((d) => d.origen === 'revocacion_art56')).toMatchObject({ estado: 'aprobada' });
    // Con el saldo reintegrado a mano, lo devuelto (150 + 200) cubre el pago: queda reembolsado.
    expect(db.pagos[0]).toMatchObject({ estado: 'reembolsado' });
  });

  it('un reembolso normal RECHAZADO no descuenta dinero ni artículos: la revocación es por el total (350) y el stock regresa completo', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = montar({ items: DOS_ARTICULOS, devoluciones: [normal({ estado: 'rechazada' })] });

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion).toMatchObject({ estado: 'pendiente_entrega', monto: 350 });
    expect(String(db.devoluciones.find((d) => d.origen === 'revocacion_art56').monto)).toBe('350');

    await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(stock).toHaveBeenCalledTimes(1);
    expect(stock.mock.calls[0][1]).toEqual([expect.objectContaining({ presentacionId: 3, cantidad: 2 }), expect.objectContaining({ presentacionId: 4, cantidad: 1 })]);
  });

  it('con todo reembolsado por devoluciones aprobadas: 409 "Este pedido ya se reembolsó por completo" y no se crea nada', async () => {
    const { pedidos, db, mercadoPago } = montar({ items: DOS_ARTICULOS, devoluciones: [normal({ id: 52, pedidoItemId: 1, monto: new Prisma.Decimal(200) }), normal({ id: 53 })] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409, message: 'Este pedido ya se reembolsó por completo' });
    expect(db.devoluciones).toHaveLength(2);
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(stock).not.toHaveBeenCalled();
  });

  it('una revocación que otra petición aprobó justo después de leer el pedido sigue respondiendo "Ya revocaste esta compra."', async () => {
    const { pedidos, db, prisma } = montar({ pedido: { metodoPago: 'efectivo' }, pagos: [pagoEfectivo()] });
    const leer = prisma.pedido.findUnique.getMockImplementation();
    prisma.pedido.findUnique.mockImplementationOnce(async (args: any) => {
      const r = await leer(args);
      db.devoluciones.push({ id: 60, pedidoId: 7, pedidoItemId: null, estado: 'aprobada', tipo: 'reembolso', origen: 'revocacion_art56', monto: new Prisma.Decimal(350) });
      return r;
    });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_5)).rejects.toMatchObject({ status: 409, message: 'Ya revocaste esta compra.' });
    expect(db.devoluciones).toHaveLength(1);
  });

  it('un cambio aprobado no bloquea ni descuenta dinero: reembolso total por Mercado Pago y el stock regresa completo (devuelve la pieza que recibió a cambio)', async () => {
    const { pedidos, devoluciones, mercadoPago } = montar({ items: DOS_ARTICULOS, devoluciones: [normal({ tipo: 'cambio', monto: null, metodoReembolso: null })] });

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion).toMatchObject({ estado: 'pendiente_entrega', monto: 350 });

    await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(stock.mock.calls[0][1]).toEqual([expect.objectContaining({ presentacionId: 3, cantidad: 2 }), expect.objectContaining({ presentacionId: 4, cantidad: 1 })]);
  });
});

describe('Nunca más de lo cobrado y el pago reembolsado cuando lo devuelto lo cubre', () => {
  it('si el pago es menor que el total, la revocación es por el pago (min(saldo, pago)) y la salida de caja también', async () => {
    const { pedidos, devoluciones, db } = montar({ pedido: { metodoPago: 'efectivo' }, pagos: [pagoEfectivo({ monto: new Prisma.Decimal(300) })] });

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion).toMatchObject({ estado: 'pendiente_entrega', monto: 300 });
    expect(String(db.devoluciones[0].monto)).toBe('300');

    await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(String(db.movimientosCaja[0].monto)).toBe('300');
    expect(db.pagos[0]).toMatchObject({ estado: 'reembolsado' });
  });

  it('una revocación guardada por más que el pago (fila anterior al tope): la salida de caja se topa con el pago', async () => {
    const { devoluciones, db } = montar({
      pedido: { metodoPago: 'efectivo' },
      pagos: [pagoEfectivo({ monto: new Prisma.Decimal(300) })],
      devoluciones: [{ id: 60, pedidoId: 7, pedidoItemId: null, estado: 'pendiente', origen: 'revocacion_art56', tipo: 'reembolso', monto: new Prisma.Decimal(350) }],
    });
    await devoluciones.recibirRevocacion(60, ESTILISTA, {});
    expect(String(db.movimientosCaja[0].monto)).toBe('300');
  });

  it('si lo devuelto no cubre el pago completo, el pago sigue aprobado (no se marca reembolsado de más)', async () => {
    // Pago mayor que el total: la revocación reintegra el total (350) y el pago (400) no queda cubierto.
    const { pedidos, devoluciones, db } = montar({ pedido: { metodoPago: 'efectivo' }, pagos: [pagoEfectivo({ monto: new Prisma.Decimal(400) })] });
    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);
    expect(r.revocacion.monto).toBe(350);
    await devoluciones.recibirRevocacion(r.revocacion.devolucionId, ESTILISTA, {});
    expect(String(db.movimientosCaja[0].monto)).toBe('350');
    expect(db.pagos[0].estado).toBe('aprobado');
  });
});

describe('Pedidos en el estado heredado "enviado": la revocación los trata como entregados', () => {
  const enviado = (historial: any[] = [{ id: 1, pedidoId: 7, estadoNuevo: 'enviado', creadoEn: EVENTO }]) =>
    montar({ pedido: { estado: EstadoPedido.enviado, pagadoEn: new Date('2026-11-02T12:00:00-06:00') }, historial });

  it('el producto está con la clienta: devolución pendiente de recibir, sin cancelar el pedido, sin regresar stock ni tocar el dinero', async () => {
    const { pedidos, db, mercadoPago, eventos } = enviado();

    const r = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    expect(r.revocacion).toMatchObject({ estado: 'pendiente_entrega', monto: 350 });
    expect(db.pedidos[0].estado).toBe('enviado');
    expect(db.devoluciones).toEqual([expect.objectContaining({ origen: 'revocacion_art56', estado: 'pendiente' })]);
    expect(stock).not.toHaveBeenCalled();
    expect(mercadoPago.reembolsarPago).not.toHaveBeenCalled();
    expect(db.pagos[0].estado).toBe('aprobado');
    expect(eventos.emit).not.toHaveBeenCalledWith('pedido.cancelado', expect.anything());
    expect(eventos.emit).toHaveBeenCalledWith('pedido.revocacion_por_recibir', expect.objectContaining({ pedidoId: 7, monto: 350 }));
  });

  it('el plazo corre desde la fecha de enviado del historial: el día 6 responde 409', async () => {
    const { pedidos, db } = enviado();
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_6)).rejects.toMatchObject({ status: 409 });
    expect(db.devoluciones).toHaveLength(0);
  });

  it('sin enviado en el historial, el plazo corre desde el pago', async () => {
    const { pedidos } = montar({ pedido: { estado: EstadoPedido.enviado }, historial: [] });
    await expect(pedidos.revocar(7, CLIENTA, undefined, DIA_6)).rejects.toMatchObject({ status: 409 });
    const otro = montar({ pedido: { estado: EstadoPedido.enviado }, historial: [] });
    await expect(otro.pedidos.revocar(7, CLIENTA, undefined, DIA_5)).resolves.toMatchObject({ revocacion: { estado: 'pendiente_entrega' } });
  });

  it('al recibir el producto: reembolso por Mercado Pago y el stock regresa una sola vez', async () => {
    const { pedidos, devoluciones, db, mercadoPago } = enviado();
    const { revocacion } = await pedidos.revocar(7, CLIENTA, undefined, DIA_5);

    await devoluciones.recibirRevocacion(revocacion.devolucionId, ESTILISTA, {});

    expect(mercadoPago.reembolsarPago).toHaveBeenCalledWith('987654', 'reembolso-pedido-31');
    expect(stock).toHaveBeenCalledTimes(1);
    expect(stock.mock.calls[0][2]).toMatchObject({ motivo: 'revocacion_compra' });
    expect(db.pagos[0].estado).toBe('reembolsado');
  });
});

describe('Revocar toma el candado de reembolsos del pedido', () => {
  it('dos revocaciones de verdad simultáneas (sin fila de transacciones): el candado deja una sola devolución; sin él habría dos por reembolsar', async () => {
    const { pedidos, db, candadosTomados } = montar({ concurrente: true });

    const r = await Promise.allSettled([pedidos.revocar(7, CLIENTA, undefined, DIA_5), pedidos.revocar(7, CLIENTA, undefined, DIA_5)]);

    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409, message: 'Ya revocaste esta compra.' });
    expect(db.devoluciones).toHaveLength(1);
    expect(candadosTomados).toEqual(['reembolsos-pedido:7', 'reembolsos-pedido:7']);
  });
});

describe('Una revocación solo se resuelve con "Recibir producto y reembolsar"', () => {
  const revocacion = (extra: Record<string, unknown> = {}) => ({ id: 60, pedidoId: 7, estado: 'pendiente', origen: 'revocacion_art56', tipo: 'reembolso', monto: new Prisma.Decimal(350), ...extra });

  it('aprobarla por la vía general responde 409 (no regresaría el stock ni reembolsaría)', async () => {
    const { devoluciones, db } = montar({ devoluciones: [revocacion()] });
    await expect(devoluciones.aprobar(60, ESTILISTA, { metodoReembolso: 'efectivo' })).rejects.toMatchObject({ status: 409 });
    expect(db.devoluciones[0].estado).toBe('pendiente');
    expect(db.movimientosCaja).toHaveLength(0);
  });

  it('una solicitud normal no se recibe por esta vía (400)', async () => {
    const { devoluciones } = montar({ devoluciones: [revocacion({ origen: 'solicitud' })] });
    await expect(devoluciones.recibirRevocacion(60, ESTILISTA, {})).rejects.toMatchObject({ status: 400 });
  });

  it('con el pedido ya cancelado por la revocación (dinero por reintegrar): no se rechaza ni la clienta la retira', async () => {
    const { devoluciones, db } = montar({ pedido: { estado: EstadoPedido.cancelado }, devoluciones: [revocacion()] });
    await expect(devoluciones.rechazar(60, ESTILISTA, {})).rejects.toMatchObject({ status: 409 });
    await expect(devoluciones.cancelar(60, CLIENTA)).rejects.toMatchObject({ status: 409 });
    expect(db.devoluciones[0].estado).toBe('pendiente');
  });

  it('con el pedido entregado, la clienta todavía puede retirar su revocación pendiente', async () => {
    const { devoluciones, db } = montar({ devoluciones: [revocacion()] });
    await devoluciones.cancelar(60, CLIENTA);
    expect(db.devoluciones[0].estado).toBe('cancelada');
  });

  it('una que no existe responde 404', async () => {
    const { devoluciones } = montar();
    await expect(devoluciones.recibirRevocacion(999, ESTILISTA, {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('Guard de "Recibir producto y reembolsar" con las claves de producción', () => {
  async function pasa(rol: string) {
    const prisma: any = { usuario: { findUnique: async () => ({ rol }) }, permisoRol: { findUnique: async () => ({ claves: CLAVES[rol] }) } };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx: any = {
      getHandler: () => (DevolucionesController.prototype as any).recibirRevocacion,
      getClass: () => DevolucionesController,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }),
    };
    try { return await guard.canActivate(ctx); } catch (e) { if (e instanceof ForbiddenException) return false; throw e; }
  }

  it('solo devoluciones:gestionar (estilista y admin); la clienta y el empleado no', async () => {
    expect(await pasa('admin')).toBe(true);
    expect(await pasa('estilista')).toBe(true);
    expect(await pasa('empleado')).toBe(false);
    expect(await pasa('cliente')).toBe(false);
  });
});
