/**
 * Offset fijo del salón (México, sin horario de verano desde 2022). No se usa la hora local
 * del servidor porque en producción corre en UTC — el offset debe ser explícito y estable.
 */
const OFFSET_MEXICO = '-06:00';

const REGEX_FECHA_SOLO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza un rango `desde`/`hasta` para filtros Prisma `gte`/`lte`.
 *
 * - Si el valor es una fecha de solo-día ('YYYY-MM-DD'), se interpreta como día completo
 *   en hora local de México (UTC-6): `desde` = inicio de ese día, `hasta` = fin de ese día
 *   (23:59:59.999), no medianoche. Así "hoy" para el usuario cubre su día completo.
 * - Si el valor ya es un datetime ISO completo (como lo envía el frontend de
 *   cola-atencion/ejecucion-servicios), se respeta tal cual, sin expandirlo.
 * - Valores inválidos se ignoran silenciosamente (mismo comportamiento previo: el llamador
 *   decide si validar el formato antes de pasarlo aquí).
 */
export function normalizarRangoFechas(desde?: string, hasta?: string): { gte?: Date; lte?: Date } {
  const rango: { gte?: Date; lte?: Date } = {};

  if (desde) {
    const d = REGEX_FECHA_SOLO.test(desde)
      ? new Date(`${desde}T00:00:00.000${OFFSET_MEXICO}`)
      : new Date(desde);
    if (!Number.isNaN(d.getTime())) rango.gte = d;
  }

  if (hasta) {
    const h = REGEX_FECHA_SOLO.test(hasta)
      ? new Date(`${hasta}T23:59:59.999${OFFSET_MEXICO}`)
      : new Date(hasta);
    if (!Number.isNaN(h.getTime())) rango.lte = h;
  }

  return rango;
}
