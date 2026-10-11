import { esDiaValido, inicioDiaMexico } from '../../common/utils/zona-mexico';

/**
 * Anticipo de citas: al agendar en línea un servicio con anticipo_monto > 0, la cita guarda la foto del
 * monto y un plazo para pagarlo. Mientras tanto la cita sigue 'pendiente' y aparta el horario; sin pago,
 * la barrida la cancela y lo libera. No hay un estado nuevo en el enum: "pendiente de anticipo" =
 * anticipo_requerido > 0 y anticipo_pagado_en nulo. Dos plazos según cómo elige pagar la clienta:
 * - En línea (Mercado Pago): HORAS_ANTICIPO_CITA, pero nunca después de MINUTOS_ANTES_PAGO_SALON antes del inicio.
 * - En el salón (anticipo_en_salon): hasta MINUTOS_ANTES_PAGO_SALON antes del inicio.
 * Las horas coinciden con PLAZOS_TERMINOS.horasAnticipoCita del frontend (Términos, sección 6).
 */
export const HORAS_ANTICIPO_CITA = 2;
export const PLAZO_ANTICIPO_MS = HORAS_ANTICIPO_CITA * 60 * 60 * 1000;
export const MINUTOS_ANTES_PAGO_SALON = 15;
export const ANTES_PAGO_SALON_MS = MINUTOS_ANTES_PAGO_SALON * 60 * 1000;

/** Cómo elige pagar el anticipo la clienta al agendar. */
export const PAGOS_ANTICIPO = ['linea', 'salon'] as const;
export type PagoAnticipo = (typeof PAGOS_ANTICIPO)[number];

/** external_reference de Mercado Pago: los pedidos usan su id; las citas, "cita-<id>". */
export const referenciaCita = (citaId: number) => `cita-${citaId}`;
/**
 * Anticipo pagado desde la app móvil: Mercado Pago regresa a RUTA_RETORNO_APP (pública, bajo /api) y
 * esta redirige al deep link fijo con solo el id de la cita, igual que DEEP_LINK_APP en el login con Google.
 */
export const RUTA_RETORNO_APP = 'pagos-en-linea/citas/retorno-app';
export const DEEP_LINK_ANTICIPO_APP = 'appmirufranco://anticipo';
export const deepLinkAnticipoApp = (citaId: number) => `${DEEP_LINK_ANTICIPO_APP}/${citaId}?retorno=mp`;

export function citaDeReferencia(referencia: string | null | undefined): number | null {
  const m = /^cita-(\d+)$/.exec(String(referencia ?? ''));
  const id = m ? Number(m[1]) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** La cita sigue apartando su horario: se le puede aplicar el anticipo. */
export const ESTADOS_CITA_VIGENTE = ['pendiente', 'confirmada', 'reprogramada'] as const;
/** Sin anticipo pagado a tiempo, estas se liberan (una confirmada a mano por el personal no se toca). */
export const ESTADOS_CITA_LIBERABLE = ['pendiente', 'reprogramada'] as const;
export const MOTIVO_ANTICIPO_NO_PAGADO = 'anticipo_no_pagado';

/** Cobro del anticipo en el salón. La tarjeta se guarda como en los pedidos ('tarjeta_terminal') para entrar al corte. */
export const METODOS_ANTICIPO_SALON = ['efectivo', 'transferencia', 'tarjeta'] as const;
export type MetodoAnticipoSalon = (typeof METODOS_ANTICIPO_SALON)[number];
export const METODO_PAGO_DE_ANTICIPO: Record<MetodoAnticipoSalon, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia',
  tarjeta: 'tarjeta_terminal',
};

export const centavos = (monto: unknown) => Math.round(Number(monto) * 100);

/**
 * ANTICIPOS_DESDE: 'YYYY-MM-DD' (inicio de ese día en México) o fecha ISO completa, igual que APARTADOS_DESDE.
 * Sin esta variable la barrida no libera citas, así que tampoco se pide anticipo al agendar (si no, la
 * cita quedaría apartada para siempre).
 */
export function anticiposDesde(): Date | null {
  const valor = (process.env.ANTICIPOS_DESDE ?? '').trim();
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return esDiaValido(valor) ? inicioDiaMexico(valor) : null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
export const requiereAnticipo = (cita: { anticipoRequerido?: unknown }) => centavos(cita.anticipoRequerido ?? 0) > 0;
