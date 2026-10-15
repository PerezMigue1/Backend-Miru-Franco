import { IsBoolean, IsOptional } from 'class-validator';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';

/**
 * Consentimiento expreso para datos sensibles (LFPDPPP): las alergias son datos de salud. No se guarda en la
 * base. Lo exige el servicio (no el DTO) en todo guardado que ponga alergias con texto y distintas de las
 * guardadas, porque solo el servicio sabe qué hay guardado y quién guarda: la titular o el personal.
 */
export const MENSAJE_SALUD_TITULAR = 'Para guardar tus alergias marca la casilla de datos de salud.';
export const MENSAJE_SALUD_PERSONAL = 'Marca que la persona aceptó que registremos sus datos de salud.';
/** `code` del 400 (con `errors.consienteDatosSensibles`) para que la web marque la casilla. */
export const CODIGO_CONSENTIMIENTO_SALUD = 'CONSENTIMIENTO_SALUD_REQUERIDO';

function conTexto(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim() !== '';
}

/** true si el cuerpo trae alergias con texto, directas o dentro de perfilCapilar. */
export function traeAlergias(dto: { alergias?: unknown; perfilCapilar?: { alergias?: unknown } | null }): boolean {
  return conTexto(dto?.alergias) || conTexto(dto?.perfilCapilar?.alergias);
}

/**
 * true si guardar `nuevas` pone alergias con texto distintas de las `guardadas` (sin contar espacios de los
 * extremos): es cuando hace falta el consentimiento expreso y su fila datos_salud. Quitar alergias o volver a
 * mandar las mismas no lo pide.
 */
export function alergiasNuevas(nuevas: unknown, guardadas: string | null | undefined): boolean {
  return conTexto(nuevas) && (nuevas as string).trim() !== (guardadas ?? '').trim();
}

/**
 * Decorador del campo `consienteDatosSensibles`: opcional y, si viene, booleano real (un texto como "false"
 * ya no se convierte en true). Que sea obligatorio lo decide el servicio.
 */
export function ConsentimientoDatosSensibles(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    IsOptional()(target, propertyKey);
    BooleanoEstricto()(target, propertyKey);
    IsBoolean({ message: 'El campo consienteDatosSensibles debe ser verdadero o falso' })(target, propertyKey);
  };
}

/** Quita el consentimiento de un cuerpo antes de mandarlo a Prisma: no es una columna. */
export function sinConsentimiento<T extends Record<string, unknown>>(datos: T): Omit<T, 'consienteDatosSensibles'> {
  const { consienteDatosSensibles: _omitido, ...resto } = datos;
  return resto;
}
