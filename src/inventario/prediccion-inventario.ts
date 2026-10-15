import { diaEnMexico, inicioDiaMexico, sumarDias } from '../common/utils/zona-mexico';

/** Semanas que entran en el promedio móvil de ventas. */
export const SEMANAS_PREDICCION = 8;

/** Pedidos en línea que cuentan como venta: pagados, en preparación, listos o entregados. */
export const ESTADOS_PEDIDO_VENDIDO = ['pagado', 'preparando', 'listo_recoger', 'entregado'] as const;

/**
 * Las últimas 8 semanas como días completos de México: desde las 00:00 del día de hace 56 días
 * hasta las 00:00 de hoy (sin incluir hoy, que todavía no termina). Para Prisma: `{ gte: desde, lt: hasta }`.
 */
export function ventanaUltimas8Semanas(ahora: Date = new Date()): { desde: Date; hasta: Date } {
  const hoy = diaEnMexico(ahora);
  return {
    desde: inicioDiaMexico(sumarDias(hoy, -SEMANAS_PREDICCION * 7)),
    hasta: inicioDiaMexico(hoy),
  };
}

const dosDecimales = (n: number) => Math.round(n * 100) / 100;

export interface CalculoPrediccion {
  unidades8Semanas: number;
  promedioSemanal: number;
  promedioDiario: number;
  /** Stock / promedio diario. null si no hubo ventas: no se inventa una cobertura. */
  diasCobertura: number | null;
  sinVentasRecientes: boolean;
}

/**
 * Promedio móvil semanal = unidades de 8 semanas / 8; promedio diario = semanal / 7;
 * días de cobertura = stock / promedio diario (con el valor sin redondear).
 */
export function calcularFilaPrediccion(stock: number, unidades8Semanas: number): CalculoPrediccion {
  const semanal = unidades8Semanas / SEMANAS_PREDICCION;
  const diario = semanal / 7;
  const sinVentas = unidades8Semanas <= 0;
  return {
    unidades8Semanas,
    promedioSemanal: dosDecimales(semanal),
    promedioDiario: dosDecimales(diario),
    diasCobertura: sinVentas ? null : dosDecimales(Math.max(0, stock) / diario),
    sinVentasRecientes: sinVentas,
  };
}
