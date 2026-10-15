import { diaEnMexico, rangoDiaMexico, sumarDias } from './zona-mexico';

/**
 * Días hábiles del salón para los plazos legales: revocación de compra (art. 56 de la Ley Federal de
 * Protección al Consumidor: 5 días hábiles), política de anticipos (excepción de 10 días hábiles) y
 * derechos ARCO (respuesta en 20 días hábiles y efectividad en 15).
 *
 * Regla autorizada por el dueño (la más protectora para la clienta): se excluyen SOLO los domingos y los
 * días de descanso obligatorio del art. 74 de la Ley Federal del Trabajo; los sábados SÍ son hábiles.
 * Los días se toman en hora de México (zona-mexico.ts): el día del evento no cuenta y el plazo vence al
 * final (23:59:59.999 hora de México) del último día hábil.
 */

/** Primer año en que aplican las reglas del 1 de octubre sexenal y de la jornada electoral del primer domingo de junio. */
const ANIO_INICIO_REGLAS_VARIABLES = 2024;

function partesDia(dia: string): { anio: number; mes: number; diaMes: number; diaSemana: number } {
  const [anio, mes, diaMes] = dia.split('-').map(Number);
  return { anio, mes, diaMes, diaSemana: new Date(Date.UTC(anio, mes - 1, diaMes)).getUTCDay() };
}

/** Día del mes del n-ésimo `diaSemana` (0 domingo, 1 lunes) de ese mes (1-12). */
function enesimoDiaSemana(anio: number, mes: number, diaSemana: number, n: number): number {
  const primero = new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();
  return 1 + ((diaSemana - primero + 7) % 7) + 7 * (n - 1);
}

/** Día de descanso obligatorio del art. 74 de la Ley Federal del Trabajo ('YYYY-MM-DD'). */
function esFestivoDia(dia: string): boolean {
  const { anio, mes, diaMes } = partesDia(dia);
  const fijos = (mes === 1 && diaMes === 1) || (mes === 5 && diaMes === 1) || (mes === 9 && diaMes === 16) || (mes === 12 && diaMes === 25);
  if (fijos) return true;
  // Primer lunes de febrero, tercer lunes de marzo y tercer lunes de noviembre.
  if (mes === 2 && diaMes === enesimoDiaSemana(anio, 2, 1, 1)) return true;
  if (mes === 3 && diaMes === enesimoDiaSemana(anio, 3, 1, 3)) return true;
  if (mes === 11 && diaMes === enesimoDiaSemana(anio, 11, 1, 3)) return true;
  if (anio >= ANIO_INICIO_REGLAS_VARIABLES) {
    // 1 de octubre de cada seis años, por la transmisión del Poder Ejecutivo Federal (2024, 2030, 2036...).
    if (mes === 10 && diaMes === 1 && anio % 6 === 2) return true;
    // Jornada electoral federal ordinaria: primer domingo de junio (2027, 2030, 2033...).
    if (mes === 6 && anio % 3 === 2 && diaMes === enesimoDiaSemana(anio, 6, 0, 1)) return true;
  }
  return false;
}

function esHabilDia(dia: string): boolean {
  return partesDia(dia).diaSemana !== 0 && !esFestivoDia(dia);
}

/** Día de calendario en México de una fecha válida ('YYYY-MM-DD'); RangeError si la fecha es inválida. */
function diaValido(fecha: Date): string {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) throw new RangeError('Fecha inválida');
  return diaEnMexico(fecha);
}

/** true si el día (en hora de México) de esa fecha es de descanso obligatorio. */
export function esFestivoOficial(fecha: Date): boolean {
  return esFestivoDia(diaValido(fecha));
}

/** true si el día (en hora de México) de esa fecha es hábil: ni domingo ni festivo oficial (el sábado es hábil). */
export function esDiaHabil(fecha: Date): boolean {
  return esHabilDia(diaValido(fecha));
}

/**
 * Fin (23:59:59.999 hora de México) del n-ésimo día hábil posterior al día de `desde`. El día de `desde` no
 * cuenta. Ej.: revocación = sumarDiasHabiles(entrega, 5); ARCO = sumarDiasHabiles(recepcion, 20).
 * Un plazo sigue vigente mientras `ahora <= vencimiento`. `n` debe ser un entero positivo.
 */
export function sumarDiasHabiles(desde: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n debe ser un entero positivo');
  let dia = diaValido(desde);
  for (let contados = 0; contados < n; ) {
    dia = sumarDias(dia, 1);
    if (esHabilDia(dia)) contados++;
  }
  return rangoDiaMexico(dia).hasta;
}

/**
 * Días hábiles después del día de `desde` hasta el día de `hasta` inclusive (en hora de México); 0 si `hasta`
 * cae el mismo día o antes. Es el inverso de sumarDiasHabiles: diasHabilesEntre(d, sumarDiasHabiles(d, n)) === n.
 * Excepción de los 10 días hábiles: diasHabilesEntre(pagoOOrden, inicioCita) <= 10.
 */
export function diasHabilesEntre(desde: Date, hasta: Date): number {
  let dia = diaValido(desde);
  const fin = diaValido(hasta);
  let habiles = 0;
  while (dia < fin) {
    dia = sumarDias(dia, 1);
    if (esHabilDia(dia)) habiles++;
  }
  return habiles;
}
