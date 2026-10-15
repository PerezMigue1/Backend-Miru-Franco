/**
 * Catálogos de la tabla consentimientos (los mismos CHECK de la migración 20261014130000) y del registro de
 * documentos legales de la web (src/app/utils/documentosLegales.ts → versiones_documentos_legales).
 */
export const TIPOS_CONSENTIMIENTO = [
  'terminos',
  'aviso_privacidad',
  'promociones',
  'datos_salud',
  'terminos_venta',
  'reembolsos',
  'anticipos',
  'fotos_resultado',
  'cookies',
] as const;
export type TipoConsentimiento = (typeof TIPOS_CONSENTIMIENTO)[number];

export const ACCIONES_CONSENTIMIENTO = ['aceptado', 'revocado'] as const;
export type AccionConsentimiento = (typeof ACCIONES_CONSENTIMIENTO)[number];

export const SLUGS_DOCUMENTO = ['terminos', 'aviso-privacidad', 'cookies', 'reembolsos', 'anticipos'] as const;
export type SlugDocumento = (typeof SLUGS_DOCUMENTO)[number];

/**
 * Documento al que se liga cada tipo. Si el elemento trae un documento, debe ser este slug (400 si no). Las
 * finalidades que describe el aviso de privacidad (promociones, datos de salud, fotos del resultado) van con el
 * aviso; los términos de venta, con los Términos (sección de compras).
 */
export const DOCUMENTO_DE_TIPO: Readonly<Record<TipoConsentimiento, SlugDocumento>> = {
  terminos: 'terminos',
  aviso_privacidad: 'aviso-privacidad',
  cookies: 'cookies',
  reembolsos: 'reembolsos',
  anticipos: 'anticipos',
  terminos_venta: 'terminos',
  promociones: 'aviso-privacidad',
  datos_salud: 'aviso-privacidad',
  fotos_resultado: 'aviso-privacidad',
};

/**
 * Tipos que son el documento mismo: para aceptarlos hay que mandar su slug, versión y hash (la versión que la
 * persona tuvo a la vista). Los demás tipos, si no traen documento, se ligan a la versión vigente del suyo.
 */
export const TIPOS_CON_DOCUMENTO_OBLIGATORIO: ReadonlySet<TipoConsentimiento> = new Set<TipoConsentimiento>([
  'terminos',
  'aviso_privacidad',
  'cookies',
  'reembolsos',
  'anticipos',
]);

/** Ruta de origen conocida de un formulario, para cuando el cuerpo no trae rutaOrigen. */
export const RUTA_DE_FORMULARIO: Readonly<Record<string, string>> = {
  perfil: '/perfil',
  perfil_privacidad: '/perfil',
};

/** Documentos que toda cuenta debe tener aceptados en su versión vigente (GET /consentimientos/pendientes). */
export const DOCUMENTOS_OBLIGATORIOS: ReadonlyArray<{ tipo: TipoConsentimiento; slug: SlugDocumento }> = [
  { tipo: 'terminos', slug: 'terminos' },
  { tipo: 'aviso_privacidad', slug: 'aviso-privacidad' },
];

/** Único método de obtención que usa el sistema (es el default de la columna). */
export const METODO_CASILLA = 'casilla_marcada';

/**
 * Campos de salud de la usuaria: las alergias (datos sensibles, ver usuarios/dto/consentimiento-datos-sensibles.ts).
 * Revocar datos_salud los deja en null.
 */
export const CAMPOS_SALUD_EN_NULL = { alergias: null } as const;
