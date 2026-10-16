import { variablesDeReglas } from '../configuracion-sitio/reglas-negocio';
import { CATALOGO_TEXTOS, DEFINICION_POR_CLAVE, variablesPermitidas, type DefinicionTexto } from './catalogo';

/**
 * Textos del sitio en memoria: TextosSitioService los carga al arrancar, cada minuto y al guardar (mismo criterio que
 * las reglas de negocio). Así los correos y los avisos leen su texto sin consultar la base en cada envío. Si la base
 * no responde, se usan los valores por defecto (los de hoy).
 */
let guardados: Record<string, string> = {};

export function establecerTextosSitio(filas: Array<{ clave: string; valor: string }> | null | undefined): void {
  const nuevo: Record<string, string> = {};
  for (const f of filas ?? []) {
    const def = DEFINICION_POR_CLAVE.get(f.clave);
    // Un valor que no pasa la validación (por ejemplo, editado a mano en la base) usa el de hoy.
    if (def && typeof f.valor === 'string' && erroresTexto(def, f.valor).length === 0) nuevo[f.clave] = f.valor;
  }
  guardados = nuevo;
}

/** El texto vigente de una clave, sin llenar (lo guardado o el valor por defecto). */
export function plantillaTexto(clave: string): string {
  const def = DEFINICION_POR_CLAVE.get(clave);
  if (!def) return '';
  return guardados[clave] ?? def.porDefecto;
}

const VARIABLE = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/**
 * Llena las variables {nombre}. Una variable sin valor queda vacía (nunca "undefined"); con `dejarFaltantes`, queda tal
 * cual con sus llaves (para que la web llene las de contexto).
 */
export function llenarVariables(texto: string, variables: Record<string, string | number | null | undefined>, dejarFaltantes = false): string {
  return texto.replace(VARIABLE, (todo, nombre: string) => {
    const v = variables[nombre];
    if (v === undefined || v === null) return dejarFaltantes ? todo : '';
    return String(v);
  });
}

/**
 * Texto de una clave con las variables de reglas (las vigentes) y las de contexto (que mandan sobre las de reglas:
 * así los plazos guardados en una cita o un pedido ganan a los de hoy).
 */
export function textoSitio(clave: string, contexto: Record<string, string | number | null | undefined> = {}): string {
  return llenarVariables(plantillaTexto(clave), { ...variablesDeReglas(), ...contexto });
}

/** Textos públicos (tipo 'texto') con las variables de reglas ya llenas; las de contexto quedan con llaves. */
export function textosPublicos(variablesReglas: Record<string, string> = variablesDeReglas()): Record<string, string> {
  return Object.fromEntries(
    CATALOGO_TEXTOS.filter((t) => t.tipo === 'texto').map((t) => [t.clave, llenarVariables(plantillaTexto(t.clave), variablesReglas, true)]),
  );
}

/** Variables que usa un texto, sin repetir. */
export function variablesDeTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(VARIABLE)].map((m) => m[1]))];
}

const HTML = /<\s*[a-zA-Z!/?]|&[a-zA-Z#][a-zA-Z0-9]*;/;
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/;
const UNA_LINEA: ReadonlySet<string> = new Set(['texto', 'correo-asunto', 'aviso-titulo']);

/** Errores en español de un texto para su clave (vacío si está bien). */
export function erroresTexto(def: DefinicionTexto, valor: unknown): string[] {
  if (typeof valor !== 'string') return ['El texto debe ser texto.'];
  const t = valor.trim();
  const errores: string[] = [];
  if (!t) errores.push('Escribe el texto. Si quieres volver al original, usa "Restaurar texto original".');
  if (t.length > def.max) errores.push(`El texto tiene como máximo ${def.max} caracteres (lleva ${t.length}).`);
  if (HTML.test(t)) errores.push('Escribe solo texto, sin etiquetas HTML ni códigos como &amp;.');
  if (CONTROL.test(t)) errores.push('El texto tiene caracteres que no se pueden mostrar.');
  if (UNA_LINEA.has(def.tipo) && /[\r\n]/.test(t)) errores.push('Este texto va en una sola línea: quita los saltos de línea.');
  // Llaves: solo {variable}. Cualquier otra llave suelta o sin cerrar es un error.
  const sinVariables = t.replace(VARIABLE, '');
  if (/[{}]/.test(sinVariables)) errores.push('Revisa las llaves: cada variable se escribe así, {nombreDeVariable}, y no puede quedar una llave suelta.');
  const permitidas = new Set(variablesPermitidas(def));
  const desconocidas = variablesDeTexto(t).filter((v) => !permitidas.has(v));
  if (desconocidas.length) {
    errores.push(
      `${desconocidas.length === 1 ? 'Esta variable no existe' : 'Estas variables no existen'} para este texto: ${desconocidas.map((v) => `{${v}}`).join(', ')}. Usa solo las de la lista.`,
    );
  }
  return errores;
}
