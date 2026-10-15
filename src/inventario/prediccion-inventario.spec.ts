import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';
import { calcularFilaPrediccion, ventanaUltimas8Semanas } from './prediccion-inventario';

/**
 * Predicción de inventario con ventas reales: unidades por presentación en las últimas 8 semanas
 * (días completos en hora de México), tienda en línea (pedidos pagados, en preparación, listos o
 * entregados) y salón (ventas pagadas). Prisma va simulado: el filtro que arma el servicio se
 * aplica de verdad a los datos de prueba con `coincide`.
 */

/** Evalúa un `where` de Prisma sobre una fila de prueba (operadores in, gte, lt, not, OR y relaciones). */
function coincide(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return cond.some((w: any) => coincide(fila, w));
    if (k === 'AND') return cond.every((w: any) => coincide(fila, w));
    const v = fila?.[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond !== 'object') return v === cond;
    const operadores = ['in', 'notIn', 'gte', 'gt', 'lte', 'lt', 'not', 'equals'];
    if (Object.keys(cond).some((o) => operadores.includes(o))) {
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('notIn' in cond && cond.notIn.includes(v)) return false;
      if ('gte' in cond && !(v != null && v >= cond.gte)) return false;
      if ('gt' in cond && !(v != null && v > cond.gt)) return false;
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false;
      if ('lt' in cond && !(v != null && v < cond.lt)) return false;
      if ('not' in cond && (cond.not === null ? v == null : v === cond.not)) return false;
      if ('equals' in cond && v !== cond.equals) return false;
      return true;
    }
    if ('is' in cond) return coincide(v, cond.is);
    return v != null && coincide(v, cond);
  });
}

function agrupar(filas: any[], where: any) {
  const suma = new Map<number, number>();
  for (const f of filas.filter((x) => coincide(x, where))) {
    suma.set(f.presentacionId, (suma.get(f.presentacionId) ?? 0) + f.cantidad);
  }
  return [...suma].map(([presentacionId, cantidad]) => ({ presentacionId, _sum: { cantidad } }));
}

// 14 de octubre de 2026, 10:00 en México (UTC-6). Ventana: del 19 de agosto 00:00 al 14 de octubre 00:00.
const AHORA = new Date('2026-10-14T16:00:00.000Z');
const DESDE = new Date('2026-08-19T06:00:00.000Z');
const HASTA = new Date('2026-10-14T06:00:00.000Z');
const DENTRO = new Date('2026-09-20T18:00:00.000Z');
const ANTES_DEL_BORDE = new Date(DESDE.getTime() - 1);

const PRESENTACIONES = [
  { id: 1, tamanio: '250 ml', stock: 14, producto: { id: 10, nombre: 'Shampoo', marca: 'Miru', categoria: 'Cabello', activo: true } },
  { id: 2, tamanio: '1 L', stock: 5, producto: { id: 20, nombre: 'Acondicionador', marca: 'Miru', categoria: 'Cabello', activo: true } },
  { id: 3, tamanio: '50 ml', stock: 3, producto: { id: 30, nombre: 'Serum retirado', marca: 'Otra', categoria: null, activo: false } },
];

const pedido = (estado: string, pagadoEn: Date | null, creadoEn = pagadoEn ?? DENTRO) => ({ estado, pagadoEn, creadoEn });
const PEDIDO_ITEMS = [
  { presentacionId: 1, cantidad: 8, pedido: pedido('pagado', DESDE) }, // borde inferior: cuenta
  { presentacionId: 1, cantidad: 5, pedido: pedido('pagado', ANTES_DEL_BORDE) }, // 1 ms antes: no cuenta
  { presentacionId: 1, cantidad: 6, pedido: pedido('entregado', DENTRO) },
  { presentacionId: 1, cantidad: 4, pedido: pedido('cancelado', DENTRO) }, // cancelado: no cuenta
  { presentacionId: 1, cantidad: 3, pedido: pedido('pendiente_pago', null, DENTRO) }, // sin pagar: no cuenta
  { presentacionId: 1, cantidad: 10, pedido: pedido('pagado', HASTA) }, // hoy (día incompleto): no cuenta
  { presentacionId: 3, cantidad: 7, pedido: pedido('pagado', DENTRO) }, // producto inactivo
];
const VENTAS_LOCAL_ITEMS = [
  { presentacionId: 1, cantidad: 2, venta: { estado: 'pagada', creadoEn: DENTRO } },
  { presentacionId: 1, cantidad: 9, venta: { estado: 'cancelada', creadoEn: DENTRO } }, // cancelada: no cuenta
  { presentacionId: 1, cantidad: 1, venta: { estado: 'pendiente', creadoEn: DENTRO } }, // pendiente: no cuenta
  { presentacionId: null, cantidad: 1, venta: { estado: 'pagada', creadoEn: DENTRO } }, // servicio
];

function servicio() {
  const prisma = {
    productoPresentacion: { findMany: jest.fn(async ({ where }: any) => PRESENTACIONES.filter((p) => coincide(p, where))) },
    pedidoItem: { groupBy: jest.fn(async ({ where }: any) => agrupar(PEDIDO_ITEMS, where)) },
    ventaLocalItem: { groupBy: jest.fn(async ({ where }: any) => agrupar(VENTAS_LOCAL_ITEMS, where)) },
  };
  return { prisma, s: new InventarioService(prisma as any) };
}

describe('Ventana de las últimas 8 semanas (hora de México)', () => {
  it('son los 56 días completos antes de hoy en México: de las 00:00 del día -56 a las 00:00 de hoy', () => {
    expect(ventanaUltimas8Semanas(AHORA)).toEqual({ desde: DESDE, hasta: HASTA });
  });

  it('a las 23:30 de México (ya es otro día en UTC) sigue siendo el mismo día de México', () => {
    expect(ventanaUltimas8Semanas(new Date('2026-10-15T05:30:00.000Z'))).toEqual({ desde: DESDE, hasta: HASTA });
  });
});

describe('Cálculo por presentación', () => {
  it('promedio semanal = total / 8, diario = semanal / 7 y cobertura = stock / diario', () => {
    expect(calcularFilaPrediccion(14, 16)).toEqual({
      unidades8Semanas: 16,
      promedioSemanal: 2,
      promedioDiario: 0.29,
      diasCobertura: 49,
      sinVentasRecientes: false,
    });
  });

  it('sin ventas: "sin ventas recientes" y sin cobertura inventada', () => {
    expect(calcularFilaPrediccion(5, 0)).toEqual({
      unidades8Semanas: 0,
      promedioSemanal: 0,
      promedioDiario: 0,
      diasCobertura: null,
      sinVentasRecientes: true,
    });
  });

  it('con ventas y sin stock la cobertura es 0 días', () => {
    expect(calcularFilaPrediccion(0, 8).diasCobertura).toBe(0);
  });
});

describe('InventarioService.prediccion con datos simulados', () => {
  it('suma tienda en línea y salón en la ventana; excluye el borde exterior, lo cancelado y lo no pagado', async () => {
    const { s } = servicio();
    const res = await s.prediccion(AHORA);
    const shampoo = res.data.find((f: any) => f.presentacionId === 1);
    // 8 (borde) + 6 (entregado) + 2 (salón pagada) = 16
    expect(shampoo).toMatchObject({
      productoId: 10,
      producto: 'Shampoo',
      tamanio: '250 ml',
      stock: 14,
      unidades8Semanas: 16,
      promedioSemanal: 2,
      promedioDiario: 0.29,
      diasCobertura: 49,
      sinVentasRecientes: false,
    });
  });

  it('solo productos activos y la presentación sin ventas sale como "sin ventas recientes"', async () => {
    const { s } = servicio();
    const res = await s.prediccion(AHORA);
    expect(res.data.map((f: any) => f.presentacionId).sort()).toEqual([1, 2]);
    expect(res.data.find((f: any) => f.presentacionId === 2)).toMatchObject({ unidades8Semanas: 0, diasCobertura: null, sinVentasRecientes: true });
    expect(res.count).toBe(2);
  });

  it('informa la ventana usada y pide a la base solo los estados de venta válidos', async () => {
    const { prisma, s } = servicio();
    const res = await s.prediccion(AHORA);
    expect(res.ventana).toEqual({ desde: DESDE, hasta: HASTA, semanas: 8 });
    const wherePedidos = prisma.pedidoItem.groupBy.mock.calls[0][0].where;
    expect(wherePedidos.pedido.estado.in.sort()).toEqual(['entregado', 'listo_recoger', 'pagado', 'preparando']);
    expect(prisma.ventaLocalItem.groupBy.mock.calls[0][0].where.venta.estado).toBe('pagada');
  });
});

describe('GET /inventario/prediccion', () => {
  it('ruta GET protegida con inventario:lectura', () => {
    const handler = InventarioController.prototype.prediccion;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('prediccion');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('permisos', handler)).toEqual(['inventario:lectura']);
  });
});
