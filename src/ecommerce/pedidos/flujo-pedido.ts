import { EstadoPedido } from '@prisma/client';

/**
 * Reglas del pedido en línea, que siempre se recoge en el salón (no hay envío a domicilio).
 *
 * - Pago en línea:        pendiente_pago → pagado → preparando → listo_recoger → entregado
 * - Pago al recoger:      pendiente_pago (apartado) → preparando → listo_recoger → entregado
 *                         (se cobra en el mostrador al entregar)
 * - cancelado se permite en cualquier punto antes de entregar; entregado y cancelado son finales.
 * - 'enviado' solo existe en pedidos anteriores: se pueden cerrar (entregado/cancelado), pero
 *   ningún pedido puede pasar a 'enviado'.
 */
export const METODO_PAGO_EN_SALON = 'pago_en_salon';
/** Pago en línea con Mercado Pago Checkout Pro: sigue el flujo en línea; lo marca pagado el webhook. */
export const METODO_PAGO_MERCADOPAGO = 'mercado_pago';
/** Cómo se cobra en el mostrador un pedido de pago al recoger (el corte de caja suma cada uno aparte). */
export const METODOS_COBRO_SALON = ['efectivo', 'tarjeta_terminal', 'transferencia'] as const;
export type MetodoCobroSalon = (typeof METODOS_COBRO_SALON)[number];

/** Un pedido en línea sin pagar se cancela a las 24 h; la preferencia de Mercado Pago vence a la misma hora. */
export const VIGENCIA_PEDIDO_EN_LINEA_MS = 24 * 60 * 60 * 1000;

export const esPagoEnSalon = (metodoPago: string | null | undefined): boolean =>
  (metodoPago ?? '').trim().toLowerCase() === METODO_PAGO_EN_SALON;

const { borrador, pendiente_pago, pagado, preparando, listo_recoger, enviado, entregado, cancelado } =
  EstadoPedido;

const SIGUIENTES: Record<EstadoPedido, EstadoPedido[]> = {
  [borrador]: [pendiente_pago, cancelado],
  [pendiente_pago]: [pagado, cancelado], // pago al recoger: ver transicionPermitida
  [pagado]: [preparando, cancelado],
  [preparando]: [listo_recoger, cancelado],
  [listo_recoger]: [entregado, cancelado],
  [enviado]: [entregado, cancelado],
  [entregado]: [],
  [cancelado]: [],
};

/** ¿El personal puede mover el pedido de `desde` a `hacia`? */
export function transicionPermitida(
  desde: EstadoPedido,
  hacia: EstadoPedido,
  metodoPago: string | null | undefined,
): boolean {
  if (desde === pendiente_pago && esPagoEnSalon(metodoPago)) {
    // El apartado no pasa por 'pagado': se cobra al entregar.
    return hacia === preparando || hacia === cancelado;
  }
  return SIGUIENTES[desde].includes(hacia);
}

/** La clienta solo puede cancelar mientras el salón no empezó a preparar su pedido. */
export const ESTADOS_CANCELABLES_POR_CLIENTA: readonly EstadoPedido[] = [pendiente_pago, pagado];

/** Estados con los que la clienta puede crear su pedido. */
export const ESTADOS_INICIALES_CLIENTA: readonly EstadoPedido[] = [borrador, pendiente_pago];

/** Con qué estado puede registrar el personal un pedido nuevo (nunca 'enviado'; 'cancelado'
 *  descontaría stock sin devolverlo). */
export const ESTADOS_INICIALES_PERSONAL: readonly EstadoPedido[] = [
  borrador,
  pendiente_pago,
  pagado,
  preparando,
  listo_recoger,
  entregado,
];

export const MENSAJE_SIN_ENVIO =
  'Los pedidos se recogen en el salón: no llevan dirección ni costo de envío.';
