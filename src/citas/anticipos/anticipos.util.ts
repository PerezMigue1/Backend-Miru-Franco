import { esDiaValido, inicioDiaMexico } from '../../common/utils/zona-mexico';

/**
 * Anticipo de citas: al agendar en línea un servicio con anticipo_monto > 0, la cita guarda la foto del
 * monto y un plazo de HORAS_ANTICIPO_CITA para pagarlo (Mercado Pago o en el salón). Mientras tanto la
 * cita sigue 'pendiente' y aparta el horario; sin pago, la barrida la cancela y lo libera. No hay un
 * estado nuevo en el enum: "pendiente de anticipo" = anticipo_requerido > 0 y anticipo_pagado_en nulo.
 * El plazo coincide con PLAZOS_TERMINOS.horasAnticipoCita del frontend (Términos, sección 6).
 */
export const HORAS_ANTICIPO_CITA = 2;
export const PLAZO_ANTICIPO_MS = HORAS_ANTICIPO_CITA * 60 * 60 * 1000;

/** external_reference de Mercado Pago: los pedidos usan su id; las citas, "cita-<id>". */
export const referenciaCita = (citaId: number) => `cita-${citaId}`;
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
