/**
 * Horario de atención por día (Configuración del sitio, clave "horario"): la fuente del sitio público y de la agenda
 * de citas. Cada día: cerrado, o abre y cierra en "HH:MM" (hora de la Ciudad de México).
 */
export const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];
export interface HorarioDia {
  dia: DiaSemana;
  cerrado: boolean;
  abre: string;
  cierra: string;
}

/** Nombre del día para Date.getUTCDay() (0 = domingo … 6 = sábado). */
const POR_INDICE: DiaSemana[] = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Horario de ese día de la semana; null si cierra o si el dato no es válido. undefined si no hay horario por día. */
export function horarioDeDiaSemana(dias: unknown, diaSemana: number): { entrada: string; salida: string } | null | undefined {
  if (!Array.isArray(dias)) return undefined;
  const dia = dias.find((d) => d && typeof d === 'object' && (d as HorarioDia).dia === POR_INDICE[diaSemana]) as HorarioDia | undefined;
  if (!dia || dia.cerrado) return null;
  if (!HORA.test(dia.abre) || !HORA.test(dia.cierra) || dia.cierra <= dia.abre) return null;
  return { entrada: dia.abre, salida: dia.cierra };
}

/** Errores de un horario por día (para guardar): los siete días, apertura antes del cierre y días cerrados. */
export function erroresHorario(dias: unknown): string[] {
  if (!Array.isArray(dias) || dias.length !== DIAS_SEMANA.length) return ['El horario debe traer los siete días de la semana.'];
  const errores: string[] = [];
  DIAS_SEMANA.forEach((nombre, i) => {
    const d = dias[i] as Partial<HorarioDia> | undefined;
    const etiqueta = ETIQUETAS_DIA[nombre];
    if (!d || d.dia !== nombre) {
      errores.push(`Falta el horario del ${etiqueta}.`);
      return;
    }
    if (typeof d.cerrado !== 'boolean') errores.push(`Indica si el ${etiqueta} está cerrado.`);
    if (d.cerrado) return;
    if (typeof d.abre !== 'string' || !HORA.test(d.abre)) errores.push(`La hora de apertura del ${etiqueta} debe tener el formato HH:MM.`);
    else if (typeof d.cierra !== 'string' || !HORA.test(d.cierra)) errores.push(`La hora de cierre del ${etiqueta} debe tener el formato HH:MM.`);
    else if (d.cierra <= d.abre) errores.push(`El ${etiqueta} debe abrir antes de cerrar.`);
  });
  if (errores.length === 0 && (dias as HorarioDia[]).every((d) => d.cerrado)) errores.push('El salón debe abrir al menos un día.');
  return errores;
}

export const ETIQUETAS_DIA: Record<DiaSemana, string> = {
  lunes: 'lunes',
  martes: 'martes',
  miercoles: 'miércoles',
  jueves: 'jueves',
  viernes: 'viernes',
  sabado: 'sábado',
  domingo: 'domingo',
};
