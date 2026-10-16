import { SLUGS_DOCUMENTO, SlugDocumento } from '../consentimientos/consentimientos.constants';

/**
 * Documentos legales que se editan en Admin > Documentos legales. Reembolsos y anticipos son una sola página
 * (/politica-de-reembolsos, la Política de anticipos es su sección #anticipos): se editan y publican juntos, con la
 * misma versión y el mismo hash, como siempre (registro documentosLegales.ts de la web).
 * El título de la página (h1) y la etiqueta del índice son los que pinta la web hoy (page.tsx de cada documento).
 */
export const PERMISO_DOCUMENTOS_LEGALES = 'configuracion:editar';

export interface DocumentoEditable {
  slug: Exclude<SlugDocumento, 'anticipos'>;
  titulo: string;
  tituloPagina: string;
  etiquetaIndice: string;
  ruta: string;
  /** Filas de versiones_documentos_legales que se publican juntas. */
  slugs: SlugDocumento[];
  /** Texto para el panel cuando la página incluye otro documento. */
  incluye?: string;
}

export const DOCUMENTOS_EDITABLES: readonly DocumentoEditable[] = [
  {
    slug: 'terminos',
    titulo: 'Términos y Condiciones',
    tituloPagina: 'Términos y Condiciones de Uso',
    etiquetaIndice: 'Índice de los términos',
    ruta: '/terminos-y-condiciones',
    slugs: ['terminos'],
  },
  {
    slug: 'aviso-privacidad',
    titulo: 'Aviso de Privacidad',
    tituloPagina: 'Aviso de Privacidad Integral',
    etiquetaIndice: 'Índice del aviso de privacidad',
    ruta: '/aviso-de-privacidad',
    slugs: ['aviso-privacidad'],
  },
  {
    slug: 'cookies',
    titulo: 'Política de Cookies',
    tituloPagina: 'Política de Cookies',
    etiquetaIndice: 'Índice de la política de cookies',
    ruta: '/politica-de-cookies',
    slugs: ['cookies'],
  },
  {
    slug: 'reembolsos',
    titulo: 'Política de Reembolsos, Cambios y Cancelaciones',
    tituloPagina: 'Política de Reembolsos, Cambios y Cancelaciones',
    etiquetaIndice: 'Índice de la política de reembolsos',
    ruta: '/politica-de-reembolsos',
    slugs: ['reembolsos', 'anticipos'],
    incluye: 'Incluye la Política de Anticipos (sección "anticipos"): se publican juntas, con la misma versión.',
  },
];

/** Título de cada documento del registro (el mismo de documentosLegales.ts de la web). */
export const TITULO_DOCUMENTO: Readonly<Record<SlugDocumento, string>> = {
  terminos: 'Términos y Condiciones',
  'aviso-privacidad': 'Aviso de Privacidad',
  cookies: 'Política de Cookies',
  reembolsos: 'Política de Reembolsos, Cambios y Cancelaciones',
  anticipos: 'Política de Anticipos',
};

export const RUTA_DOCUMENTO: Readonly<Record<SlugDocumento, string>> = {
  terminos: '/terminos-y-condiciones',
  'aviso-privacidad': '/aviso-de-privacidad',
  cookies: '/politica-de-cookies',
  reembolsos: '/politica-de-reembolsos',
  anticipos: '/politica-de-reembolsos#anticipos',
};

export function esSlugDocumento(slug: string): slug is SlugDocumento {
  return (SLUGS_DOCUMENTO as readonly string[]).includes(slug);
}

/** El documento editable de un slug: anticipos se edita con reembolsos. null si no es un documento legal. */
export function documentoEditableDe(slug: string): DocumentoEditable | null {
  return DOCUMENTOS_EDITABLES.find((d) => d.slugs.includes(slug as SlugDocumento)) ?? null;
}

/** Límites del editor. */
/** Caracteres; con el JSON del cuerpo queda bajo el límite de 100 kB de Express. */
export const MAX_PLANTILLA = 60_000;
export const MIN_MOTIVO = 10;
export const MAX_MOTIVO = 1000;
export const VERSION_VALIDA = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

/** Nombre legible de cada variable de reglas (para el menú "Insertar variable" del editor). */
export const ETIQUETAS_VARIABLES: Readonly<Record<string, string>> = {
  plazoAnticipoHoras: 'Horas para pagar el anticipo en línea',
  minutosAntesPagoSalon: 'Minutos antes de la cita en que vence el anticipo',
  minutosLlegadaAntes: 'Minutos antes de la cita para llegar a pagar el anticipo',
  toleranciaLlegadaMinutos: 'Minutos de tolerancia para llegar a la cita',
  horasAvisoCancelarReagendar: 'Horas de aviso para cancelar o reagendar',
  mesesSoloPagoEnLinea: 'Meses con solo pago en línea después de una falta',
  diasHabilesExcepcionAnticipo: 'Días hábiles desde los que el anticipo no se devuelve',
  diasHabilesCancelarConReembolso: 'Días hábiles para cancelar con reembolso del anticipo',
  plazoPagoLineaHoras: 'Horas para pagar un pedido en línea',
  diasPrepararApartado: 'Días para preparar un apartado',
  diaRecordatorioRecoger: 'Día del recordatorio para recoger un apartado',
  diasCancelarNoRecogido: 'Días para recoger un apartado antes de cancelarlo',
  diasRestantesRecoger: 'Días que quedan para recoger después del recordatorio',
  diasResguardo: 'Días que se guarda un pedido pagado',
  tiempoPreparacion: 'Tiempo estimado de preparación',
  diasCambioProducto: 'Días para cambiar un producto',
  diasHabilesRevocacion: 'Días hábiles para revocar una compra en línea',
  diasGarantia: 'Días de garantía de un servicio',
  plazoFactura: 'Plazo para pedir factura',
  diasHabilesArcoRespuesta: 'Días hábiles para responder una solicitud ARCO',
  diasHabilesArcoEfectividad: 'Días hábiles para hacer efectiva una solicitud ARCO',
};
