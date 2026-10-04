import { Equals, ValidateIf } from 'class-validator';

/**
 * Consentimiento expreso para datos sensibles (LFPDPPP): las alergias son datos de salud.
 * Se exige en cada petición que trae alergias con texto y NO se guarda en la base.
 */
export const MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES =
  'Para guardar alergias se necesita el consentimiento expreso para usar datos de salud (consienteDatosSensibles: true).';

function conTexto(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim() !== '';
}

/** true si el cuerpo trae alergias con texto, directas o dentro de perfilCapilar. */
export function traeAlergias(dto: { alergias?: unknown; perfilCapilar?: { alergias?: unknown } | null }): boolean {
  return conTexto(dto?.alergias) || conTexto(dto?.perfilCapilar?.alergias);
}

/**
 * Decorador del campo `consienteDatosSensibles`: solo se valida cuando hay alergias con texto, y entonces
 * debe ser exactamente `true`. Sin alergias el campo es opcional (no lleva @IsOptional a propósito:
 * @IsOptional saltaría la validación justo cuando falta).
 */
export function ConsentimientoDatosSensibles(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    ValidateIf((dto) => traeAlergias(dto))(target, propertyKey);
    Equals(true, { message: MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES })(target, propertyKey);
  };
}

/** Quita el consentimiento de un cuerpo antes de mandarlo a Prisma: no es una columna. */
export function sinConsentimiento<T extends Record<string, unknown>>(datos: T): Omit<T, 'consienteDatosSensibles'> {
  const { consienteDatosSensibles: _omitido, ...resto } = datos;
  return resto;
}
