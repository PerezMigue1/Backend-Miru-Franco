import { escaparHtml } from './html-seguro';

/**
 * Variables de reglas en los documentos legales: {plazoPagoLineaHoras}, {diasGarantia}... (VARIABLES_REGLAS de
 * configuracion-sitio/reglas-negocio.ts). Al publicar se llenan con su valor de ese momento y ese valor queda
 * guardado con la versión: el texto publicado (y su hash) no cambia solo si después cambia la regla.
 */
const PATRON = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Nombres de las variables que usa la plantilla, sin repetir y en orden de aparición. */
export function variablesUsadas(plantilla: string): string[] {
  return [...new Set([...plantilla.matchAll(PATRON)].map((m) => m[1]))];
}

export function variablesDesconocidas(plantilla: string, conocidas: readonly string[]): string[] {
  return variablesUsadas(plantilla).filter((v) => !conocidas.includes(v));
}

/** El valor tal como se escribe dentro del formato sencillo: sin que sus caracteres se lean como formato o html. */
function valorEnMarcado(valor: string): string {
  return escaparHtml(valor).replace(/\*/g, '&#42;').replace(/`/g, '&#96;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
}

/** Plantilla con cada variable conocida reemplazada por su valor. Las desconocidas quedan como están. */
export function llenarVariables(plantilla: string, valores: Readonly<Record<string, string>>): string {
  return plantilla.replace(PATRON, (m, nombre: string) => (Object.prototype.hasOwnProperty.call(valores, nombre) ? valorEnMarcado(valores[nombre]) : m));
}

/** Solo las variables que la plantilla usa, con su valor (lo que se guarda con la versión). */
export function valoresUsados(plantilla: string, valores: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(variablesUsadas(plantilla).filter((v) => v in valores).map((v) => [v, valores[v]]));
}

export interface VariableDesactualizada {
  nombre: string;
  /** Valor con el que se publicó la versión vigente. */
  publicado: string;
  /** Valor de la regla hoy (o el propuesto). */
  actual: string;
}

/** Variables guardadas en una versión cuyo valor ya no es el de la regla. */
export function variablesDesactualizadas(guardadas: unknown, actuales: Readonly<Record<string, string>>): VariableDesactualizada[] {
  if (!guardadas || typeof guardadas !== 'object' || Array.isArray(guardadas)) return [];
  return Object.entries(guardadas as Record<string, unknown>)
    .filter(([nombre, valor]) => nombre in actuales && String(valor) !== actuales[nombre])
    .map(([nombre, valor]) => ({ nombre, publicado: String(valor), actual: actuales[nombre] }));
}
