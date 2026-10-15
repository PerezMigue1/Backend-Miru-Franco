/**
 * Eventos de dominio que alimentan los avisos en vivo (campana, aviso en pantalla y notificación del navegador).
 * Viven aparte del listener para que los services que los emiten no importen el listener.
 */

/** Un reembolso ya hecho (pago marcado reembolsado): la clienta recibe el aviso. */
export const EVENTO_REEMBOLSO_REALIZADO = 'reembolso.realizado';
export interface ReembolsoRealizadoEvent {
  /** null si la cita o el pedido no tienen cuenta de clienta: no hay a quién avisar. */
  usuarioId: string | null;
  entidadTipo: 'pedido' | 'cita';
  entidadId: number;
  monto: number;
  /** Identifica el reembolso (p. ej. `pago-12`, `devolucion-5`): un aviso por reembolso aunque haya varios del mismo pedido. */
  referencia: string;
}

/** La titular creó una solicitud ARCO: los admin la atienden. */
export const EVENTO_ARCO_SOLICITUD_CREADA = 'arco.solicitud_creada';
export interface ArcoSolicitudCreadaEvent {
  solicitudId: number;
  folio: string;
  tipo: string;
}

/** El admin respondió, atendió o rechazó una solicitud ARCO: la titular recibe el aviso (sin el texto). */
export const EVENTO_ARCO_RESPONDIDA = 'arco.respondida';
export interface ArcoRespondidaEvent {
  solicitudId: number;
  usuarioId: string;
  folio: string;
  estado: string;
}
