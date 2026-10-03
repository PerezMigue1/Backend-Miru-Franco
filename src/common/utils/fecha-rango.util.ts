import { rangoDiaMexico } from './zona-mexico';

const REGEX_FECHA_SOLO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza un rango `desde`/`hasta` para filtros Prisma `gte`/`lte`.
 *
 * - Si el valor es una fecha de solo-día ('YYYY-MM-DD'), se interpreta como día completo
 *   en hora de México (zona-mexico.ts, con la regla horaria real, no un desfase fijo):
 *   `desde` = inicio de ese día, `hasta` = fin de ese día (23:59:59.999), no medianoche.
 *   Así "hoy" para el usuario cubre su día completo.
 * - Si el valor ya es un datetime ISO completo (como lo envía el frontend de
 *   cola-atencion/ejecucion-servicios), se respeta tal cual, sin expandirlo.
 * - Valores inválidos se ignoran silenciosamente (mismo comportamiento previo: el llamador
 *   decide si validar el formato antes de pasarlo aquí). Un día imposible con formato válido
 *   (2026-02-30) se desborda al mes siguiente, como antes.
 */
export function normalizarRangoFechas(desde?: string, hasta?: string): { gte?: Date; lte?: Date } {
  const rango: { gte?: Date; lte?: Date } = {};

  if (desde) {
    const d = REGEX_FECHA_SOLO.test(desde) ? rangoDiaMexico(desde).desde : new Date(desde);
    if (!Number.isNaN(d.getTime())) rango.gte = d;
  }

  if (hasta) {
    const h = REGEX_FECHA_SOLO.test(hasta) ? rangoDiaMexico(hasta).hasta : new Date(hasta);
    if (!Number.isNaN(h.getTime())) rango.lte = h;
  }

  return rango;
}

/**
 * Para columnas que guardan un día de calendario a medianoche UTC (p. ej. CorteCaja.fecha, que se
 * crea con `new Date('YYYY-MM-DD')`): el día D es [D 00:00:00.000Z, D 23:59:59.999Z]. No es la hora
 * de México: es el mismo criterio con el que se guardó. Un datetime ISO completo se respeta.
 */
export function normalizarRangoFechasSoloDia(desde?: string, hasta?: string): { gte?: Date; lte?: Date } {
  const rango: { gte?: Date; lte?: Date } = {};
  if (desde) {
    const d = new Date(REGEX_FECHA_SOLO.test(desde) ? `${desde}T00:00:00.000Z` : desde);
    if (!Number.isNaN(d.getTime())) rango.gte = d;
  }
  if (hasta) {
    const h = new Date(REGEX_FECHA_SOLO.test(hasta) ? `${hasta}T23:59:59.999Z` : hasta);
    if (!Number.isNaN(h.getTime())) rango.lte = h;
  }
  return rango;
}
