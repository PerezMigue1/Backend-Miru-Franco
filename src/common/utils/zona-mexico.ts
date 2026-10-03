/**
 * Zona horaria del negocio. El servidor (Render) corre en UTC: "hoy", el inicio de un día o de un
 * mes se calculan siempre en hora de México con Intl, nunca con la hora del servidor ni con un
 * desfase fijo (-06:00), para que sigan bien si la regla horaria cambia.
 */
export const ZONA_NEGOCIO = 'America/Mexico_City';

const REGEX_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const PARTES = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partesEnMexico(instante: Date) {
  const p = Object.fromEntries(PARTES.formatToParts(instante).map((x) => [x.type, x.value]));
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

const dosDigitos = (n: number) => String(n).padStart(2, '0');

/** Cuánto va la hora de México respecto a UTC en ese instante, en ms (p. ej. -6 h). */
function desfaseEn(instante: Date): number {
  const p = partesEnMexico(instante);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** 'YYYY-MM-DD' del día de calendario en México de ese instante (por defecto, ahora). */
export function diaEnMexico(instante: Date = new Date()): string {
  const p = partesEnMexico(instante);
  return `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}`;
}

/** true si es un día 'YYYY-MM-DD' válido. */
export function esDiaValido(dia: string): boolean {
  const m = REGEX_DIA.exec(dia);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Instante (UTC) en que empiezan las 00:00 de ese día en México. */
export function inicioDiaMexico(dia: string): Date {
  const m = REGEX_DIA.exec(dia);
  if (!m) throw new Error(`Día inválido: ${dia}`);
  const medianocheUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Primera aproximación con el desfase de ese momento y una segunda pasada por si el desfase
  // cambia justo ese día.
  let t = medianocheUtc - desfaseEn(new Date(medianocheUtc));
  t = medianocheUtc - desfaseEn(new Date(t));
  return new Date(t);
}

/** 'YYYY-MM-DD' sumando días de calendario. */
export function sumarDias(dia: string, dias: number): string {
  const m = REGEX_DIA.exec(dia);
  if (!m) throw new Error(`Día inválido: ${dia}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias));
  return `${d.getUTCFullYear()}-${dosDigitos(d.getUTCMonth() + 1)}-${dosDigitos(d.getUTCDate())}`;
}

/**
 * Rango de un día de México como instantes UTC: de las 00:00:00.000 a las 23:59:59.999 hora de
 * México. Para Prisma: `{ gte: desde, lte: hasta }`.
 */
export function rangoDiaMexico(dia: string): { desde: Date; hasta: Date } {
  const desde = inicioDiaMexico(dia);
  const hasta = new Date(inicioDiaMexico(sumarDias(dia, 1)).getTime() - 1);
  return { desde, hasta };
}

/** Rango del mes de México (mes 1-12) como instantes UTC, igual que rangoDiaMexico. */
export function rangoMesMexico(anio: number, mes: number): { desde: Date; hasta: Date } {
  const primero = `${anio}-${dosDigitos(mes)}-01`;
  const siguiente = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${dosDigitos(mes + 1)}-01`;
  return { desde: inicioDiaMexico(primero), hasta: new Date(inicioDiaMexico(siguiente).getTime() - 1) };
}

/**
 * Días de calendario desde hoy (en México) hasta una fecha de solo día guardada en UTC (medianoche
 * o mediodía UTC: se toma su día UTC). Hoy 0, mañana 1, ayer -1, a cualquier hora.
 * Mismo criterio que el frontend (utils/fechaSoloDia.ts → diasHastaFechaSoloDia).
 */
export function diasHastaDiaCalendario(fecha: Date, ahora: Date = new Date()): number {
  const dia = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  const [a, m, d] = diaEnMexico(ahora).split('-').map(Number);
  return Math.round((dia - Date.UTC(a, m - 1, d)) / MS_POR_DIA);
}
