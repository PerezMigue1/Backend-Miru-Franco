/**
 * external_reference de Mercado Pago con prefijo por entorno. Desarrollo se copió de producción, así que los ids de
 * pedidos y citas se repiten entre las dos bases: sin prefijo, un aviso de una prueba local que llegara a producción
 * caería sobre otro pedido. Con "dev-" o "prod-", cada backend aplica solo lo suyo. Las referencias sin prefijo, ya
 * emitidas antes de este cambio (también desde la app), siguen valiendo.
 */
export type EntornoPagos = 'dev' | 'prod';
export type TipoReferencia = 'pedido' | 'cita';
export type OrigenReferencia = 'propio' | 'otro_entorno' | 'sin_prefijo';
export interface ReferenciaLeida {
  tipo: TipoReferencia;
  id: number;
  origen: OrigenReferencia;
}

/** MP_ENTORNO (dev o prod); sin él, NODE_ENV=production es prod y cualquier otro valor es dev. */
export function entornoPagos(env: Record<string, string | undefined> = process.env): EntornoPagos {
  const valor = (env.MP_ENTORNO ?? '').trim().toLowerCase();
  if (valor === 'dev' || valor === 'prod') return valor;
  return env.NODE_ENV === 'production' ? 'prod' : 'dev';
}

/**
 * Aviso para el log al arrancar: con Mercado Pago configurado y sin MP_ENTORNO válido, el entorno se dedujo de
 * NODE_ENV. No se exige (un deploy sin la variable seguiría cobrando), pero se avisa para definirla. Nunca incluye
 * el token.
 */
export function avisoEntornoPagos(env: Record<string, string | undefined> = process.env): string | null {
  if (!env.MP_ACCESS_TOKEN) return null;
  const valor = (env.MP_ENTORNO ?? '').trim().toLowerCase();
  if (valor === 'dev' || valor === 'prod') return null;
  return `MP_ENTORNO no está definido (dev o prod): las referencias de Mercado Pago usan "${entornoPagos(env)}", deducido de NODE_ENV. Defínelo en cada entorno para que desarrollo y producción no se mezclen.`;
}

export const referenciaPedido = (pedidoId: number, entorno: EntornoPagos = entornoPagos()) => `${entorno}-${pedidoId}`;
export const referenciaCitaPago = (citaId: number, entorno: EntornoPagos = entornoPagos()) => `${entorno}-cita-${citaId}`;

const PATRON = /^(?:(dev|prod)-)?(cita-)?([1-9]\d*)$/;

/** null si la referencia no es de un pedido ni de una cita. */
export function leerReferencia(referencia: string | null | undefined, entorno: EntornoPagos = entornoPagos()): ReferenciaLeida | null {
  const m = PATRON.exec(String(referencia ?? ''));
  if (!m) return null;
  const id = Number(m[3]);
  if (!Number.isSafeInteger(id)) return null;
  const origen: OrigenReferencia = !m[1] ? 'sin_prefijo' : m[1] === entorno ? 'propio' : 'otro_entorno';
  return { tipo: m[2] ? 'cita' : 'pedido', id, origen };
}

/**
 * Referencia antigua sin prefijo: el id pudo ser de la otra base. El pago no puede ser anterior al pedido o la cita
 * (sin fecha de creación en el pago no se descarta). true si hay que ignorarlo.
 */
export function pagoAnteriorAlRegistro(pago: { date_created?: string | null }, creadoEn: Date): boolean {
  if (!pago.date_created) return false;
  const creado = new Date(pago.date_created).getTime();
  return Number.isFinite(creado) && creado < new Date(creadoEn).getTime();
}

/** Llave del candado de Postgres (pg_advisory_xact_lock) para aplicar un pago de Mercado Pago. */
export const llaveCandadoPago = (paymentId: string | number) => `mercadopago:${paymentId}`;

/** El último pago en Mercado Pago de la primera referencia que tenga alguno (la nueva antes que la antigua). */
export async function buscarUltimoPagoEnReferencias<T>(
  mp: { buscarUltimoPago(referencia: string): Promise<T | null> },
  referencias: string[],
): Promise<T | null> {
  for (const referencia of referencias) {
    const pago = await mp.buscarUltimoPago(referencia);
    if (pago) return pago;
  }
  return null;
}

/** Referencias a buscar en Mercado Pago, en orden: la nueva y la antigua sin prefijo. */
export function referenciasDeBusqueda(tipo: TipoReferencia, id: number, entorno: EntornoPagos = entornoPagos()): string[] {
  return tipo === 'cita' ? [referenciaCitaPago(id, entorno), `cita-${id}`] : [referenciaPedido(id, entorno), String(id)];
}
