import { EstadoPedido } from '@prisma/client';
import { sumarDiasHabiles } from '../../common/utils/dias-habiles.util';
import { ZONA_NEGOCIO } from '../../common/utils/zona-mexico';

/**
 * Revocación de compra (art. 56 de la Ley Federal de Protección al Consumidor): la clienta revoca su compra
 * en línea sin dar razones dentro de los 5 días hábiles siguientes a la entrega del pedido en el salón (o al
 * pago, si todavía no se entrega) y se le reintegra todo lo pagado. Días hábiles: dias-habiles.util.ts.
 */
export const DIAS_HABILES_REVOCACION = 5;

/** Devoluciones.origen de una revocación (CHECK en la base). Las demás son 'solicitud'. */
export const ORIGEN_REVOCACION = 'revocacion_art56';

/** Un pedido se revoca si ya está pagado (o en un estado posterior) y no está cancelado. */
export const ESTADOS_REVOCABLES: readonly EstadoPedido[] = [
  EstadoPedido.pagado,
  EstadoPedido.preparando,
  EstadoPedido.listo_recoger,
  EstadoPedido.enviado,
  EstadoPedido.entregado,
];

/**
 * Estados en que el producto ya está con la clienta: entregado y el heredado 'enviado' (pedidos anteriores a la
 * recogida en el salón). La revocación no cancela el pedido ni regresa stock: espera a que lo devuelva.
 */
export const ESTADOS_PRODUCTO_CON_CLIENTA: readonly EstadoPedido[] = [EstadoPedido.entregado, EstadoPedido.enviado];

export function productoConClienta(estado: EstadoPedido | string): boolean {
  return ESTADOS_PRODUCTO_CON_CLIENTA.includes(estado as EstadoPedido);
}

export interface DatosPlazoRevocacion {
  estado: EstadoPedido | string;
  pagadoEn: Date | null;
  /** Cuándo pasó a 'entregado' según el historial de estados. */
  entregadoEn: Date | null;
  /** Cuándo pasó a 'enviado' (estado heredado) según el historial. */
  enviadoEn?: Date | null;
  /** Ya tiene una revocación pendiente o aprobada. */
  yaRevocado: boolean;
  /** Días hábiles guardados en el pedido al crearlo (reglasDePedido); sin dato, los de ley. Nunca menos de 5. */
  diasHabiles?: number;
  /** Días inhábiles del salón guardados en el pedido; sin dato, solo los de ley. */
  diasInhabiles?: string[];
}

/**
 * Hasta cuándo se puede revocar (fin del 5.º día hábil, hora de México) y si se puede hoy. Corre desde la
 * entrega (o, en el heredado 'enviado', desde que se envió) según el historial; si no hay fila, desde el pago.
 */
export function plazoRevocacion(p: DatosPlazoRevocacion, ahora: Date = new Date()): { revocableHasta: Date | null; puedeRevocar: boolean } {
  const inicio = (p.estado === EstadoPedido.enviado ? p.enviadoEn : p.entregadoEn) ?? p.pagadoEn;
  if (!ESTADOS_REVOCABLES.includes(p.estado as EstadoPedido) || !inicio) return { revocableHasta: null, puedeRevocar: false };
  const revocableHasta = sumarDiasHabiles(inicio, Math.max(DIAS_HABILES_REVOCACION, p.diasHabiles ?? DIAS_HABILES_REVOCACION), p.diasInhabiles ?? []);
  return { revocableHasta, puedeRevocar: !p.yaRevocado && ahora.getTime() <= revocableHasta.getTime() };
}

const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_NEGOCIO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** 409 cuando ya pasó el plazo: la fecha en que terminó, en español y hora de México. */
export function mensajePlazoRevocacionTerminado(revocableHasta: Date): string {
  return `El plazo para revocar tu compra terminó el ${FECHA_LARGA.format(revocableHasta)}. Si tienes un problema con tu pedido, comunícate con el salón.`;
}
