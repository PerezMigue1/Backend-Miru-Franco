import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * Constraints comunes: el texto por defecto de class-validator (en inglés) y su traducción con el
 * nombre del campo. `valor` es lo que el texto por defecto trae al final (el mínimo, las opciones…).
 */
const TRADUCCIONES: Record<string, { porDefecto: RegExp; es: (campo: string, valor: string) => string }> = {
  isNotEmpty: { porDefecto: /should not be empty$/, es: (c) => `El campo ${c} es obligatorio` },
  isString: { porDefecto: /must be a string$/, es: (c) => `El campo ${c} debe ser texto` },
  isEmail: { porDefecto: /must be an email$/, es: (c) => `El campo ${c} debe ser un correo válido` },
  isInt: { porDefecto: /must be an integer number$/, es: (c) => `El campo ${c} debe ser un número entero` },
  isNumber: { porDefecto: /must be a number conforming to the specified constraints$/, es: (c) => `El campo ${c} debe ser un número` },
  min: { porDefecto: /must not be less than (.+)$/, es: (c, v) => `El campo ${c} debe ser al menos ${v}` },
  max: { porDefecto: /must not be greater than (.+)$/, es: (c, v) => `El campo ${c} no debe ser mayor que ${v}` },
  minLength: { porDefecto: /must be longer than or equal to (\d+) characters$/, es: (c, v) => `El campo ${c} debe tener al menos ${v} caracteres` },
  maxLength: { porDefecto: /must be shorter than or equal to (\d+) characters$/, es: (c, v) => `El campo ${c} debe tener como máximo ${v} caracteres` },
  isIn: { porDefecto: /must be one of the following values: (.*)$/, es: (c, v) => `El campo ${c} debe ser uno de: ${v}` },
  isEnum: { porDefecto: /must be one of the following values: (.*)$/, es: (c, v) => `El campo ${c} debe ser uno de: ${v}` },
  isBoolean: { porDefecto: /must be a boolean value$/, es: (c) => `El campo ${c} debe ser verdadero o falso` },
  isDateString: { porDefecto: /must be a valid ISO 8601 date string$/, es: (c) => `El campo ${c} debe ser una fecha válida` },
  isUuid: { porDefecto: /must be a UUID$/, es: (c) => `El campo ${c} debe ser un identificador válido` },
  whitelistValidation: { porDefecto: /should not exist$/, es: (c) => `El campo ${c} no está permitido` },
  isPositive: { porDefecto: /must be a positive number$/, es: (c) => `El campo ${c} debe ser mayor que 0` },
  matches: { porDefecto: /must match .* regular expression$/, es: (c) => `El campo ${c} no tiene el formato correcto` },
  isArray: { porDefecto: /must be an array$/, es: (c) => `El campo ${c} debe ser una lista` },
  arrayNotEmpty: { porDefecto: /should not be empty$/, es: (c) => `El campo ${c} no puede estar vacío` },
  isObject: { porDefecto: /must be an object$/, es: (c) => `El campo ${c} debe ser un objeto` },
  isDefined: { porDefecto: /should not be null or undefined$/, es: (c) => `El campo ${c} es obligatorio` },
  arrayMinSize: { porDefecto: /must contain at least (\d+) elements$/, es: (c, v) => `El campo ${c} debe tener al menos ${v} elementos` },
  arrayMaxSize: { porDefecto: /must contain no more than (\d+) elements$/, es: (c, v) => `El campo ${c} debe tener como máximo ${v} elementos` },
  isNumberString: { porDefecto: /must be a number string$/, es: (c) => `El campo ${c} debe contener solo números` },
  isUrl: { porDefecto: /must be a URL address$/, es: (c) => `El campo ${c} debe ser una URL válida` },
  equals: { porDefecto: /must be equal to .*$/, es: (c) => `El campo ${c} no tiene el valor esperado` },
  isDate: { porDefecto: /must be a Date instance$/, es: (c) => `El campo ${c} debe ser una fecha válida` },
  isNotEmptyObject: { porDefecto: /must be a non-empty object$/, es: (c) => `El campo ${c} no puede estar vacío` },
};
/** Forma de cualquier texto por defecto de class-validator ("x must…", "property x should not exist"…). */
const TEXTO_POR_DEFECTO = /^(each value in |nested property |property )?\S+ (must|should) /;

/** El mensaje de una constraint en español: el propio si lo tiene, o la traducción del texto por defecto. */
function mensajeEnEspanol(clave: string, mensaje: string, campo: string): string {
  const t = TRADUCCIONES[clave];
  const m = t?.porDefecto.exec(mensaje);
  if (t && m) return t.es(campo, m[1] ?? '');
  return TEXTO_POR_DEFECTO.test(mensaje) ? `El campo ${campo} no es válido` : mensaje;
}

function flattenValidationErrors(
  validationErrors: ValidationError[],
  parentPath = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const err of validationErrors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;
    const primera = Object.entries(err.constraints ?? {})[0];
    if (primera) {
      out[path] = primera[1] ? mensajeEnEspanol(primera[0], primera[1], err.property) : 'Campo inválido';
    }
    if (err.children?.length) {
      Object.assign(out, flattenValidationErrors(err.children, path));
    }
  }
  return out;
}

/** exceptionFactory del ValidationPipe global: 400 con formato { success, error, message, errors } (guía 400/403/500). */
export function crearErrorDeValidacion(validationErrors: ValidationError[]) {
  const errors = flattenValidationErrors(validationErrors);
  return new BadRequestException({
    success: false,
    error: 'Errores de validación',
    message: 'Revisa los campos del formulario',
    errors,
  });
}
