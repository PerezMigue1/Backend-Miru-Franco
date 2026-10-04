import { diaEnMexico } from '../../common/utils/zona-mexico';

/**
 * Política de cambios y reembolsos de los Términos y Condiciones (sección 5):
 * - cambio: producto sellado y sin abrir, o con defecto de fábrica, dentro de 7 días naturales tras recogerlo;
 * - reembolso: defecto de fábrica, producto distinto al pedido, falta de existencias (o cancelación del salón),
 *   o cancelación de un pedido pagado en línea antes de que estuviera listo para recoger.
 * La tabla devoluciones no tiene columnas de tipo ni causa: quedan registrados al inicio del motivo.
 */
export const DIAS_CAMBIO_PRODUCTO = 7;

export const TIPOS_DEVOLUCION = ['cambio', 'reembolso'] as const;
export type TipoDevolucion = (typeof TIPOS_DEVOLUCION)[number];

export const CAUSAS_DEVOLUCION = ['sellado_sin_abrir', 'defecto_fabrica', 'producto_distinto', 'sin_existencias', 'cancelacion_antes_listo'] as const;
export type CausaDevolucion = (typeof CAUSAS_DEVOLUCION)[number];

export const CAUSAS_POR_TIPO: Record<TipoDevolucion, CausaDevolucion[]> = {
  cambio: ['sellado_sin_abrir', 'defecto_fabrica'],
  reembolso: ['defecto_fabrica', 'producto_distinto', 'sin_existencias', 'cancelacion_antes_listo'],
};

const ETIQUETA_TIPO: Record<TipoDevolucion, string> = { cambio: 'Cambio', reembolso: 'Reembolso' };
const ETIQUETA_CAUSA: Record<CausaDevolucion, string> = {
  sellado_sin_abrir: 'Producto sellado y sin abrir',
  defecto_fabrica: 'Defecto de fábrica',
  producto_distinto: 'Producto distinto al pedido',
  sin_existencias: 'Falta de existencias',
  cancelacion_antes_listo: 'Cancelado antes de estar listo',
};

export interface PedidoParaPolitica {
  estado: string;
  pagadoEn: Date | null;
  metodoPago: string | null;
  /** Cuándo se entregó (historial a 'entregado'). */
  entregadoEn: Date | null;
  /** Si en algún momento llegó a 'listo_recoger'. */
  llegoAListo: boolean;
}

/** Días naturales (en México) entre la entrega y hoy. */
function diasDesde(fecha: Date, ahora: Date): number {
  const dia = (d: Date) => Date.parse(`${diaEnMexico(d)}T00:00:00.000Z`);
  return Math.round((dia(ahora) - dia(fecha)) / 86_400_000);
}

/** Devuelve el motivo por el que no aplica, o null si la solicitud cumple la política. */
export function validarPoliticaDevolucion(
  s: { tipo: TipoDevolucion; causa: CausaDevolucion; sellado?: boolean; pedidoItemId?: number | null; pedido: PedidoParaPolitica },
  ahora: Date = new Date(),
): string | null {
  if (!CAUSAS_POR_TIPO[s.tipo]?.includes(s.causa)) {
    return `La causa "${ETIQUETA_CAUSA[s.causa] ?? s.causa}" no aplica para un ${s.tipo}`;
  }
  const requiereEntregado = s.tipo === 'cambio' || s.causa === 'defecto_fabrica' || s.causa === 'producto_distinto';
  if (requiereEntregado) {
    if (s.pedido.estado !== 'entregado' || !s.pedido.entregadoEn) return 'El pedido todavía no se ha entregado';
    if (s.pedidoItemId == null) return 'Elige el artículo del pedido';
  }
  if (s.tipo === 'cambio') {
    if (diasDesde(s.pedido.entregadoEn as Date, ahora) > DIAS_CAMBIO_PRODUCTO) {
      return `El cambio solo procede dentro de los ${DIAS_CAMBIO_PRODUCTO} días naturales siguientes a recogerlo`;
    }
    if (s.causa === 'sellado_sin_abrir' && !s.sellado) return 'Confirma que el producto está sellado y sin abrir';
    return null;
  }
  // Reembolso: debe haber un pago que devolver.
  if (!s.pedido.pagadoEn) return 'El pedido no está pagado: no hay nada que reembolsar';
  if (s.causa === 'sin_existencias' && s.pedido.estado === 'entregado') {
    return 'Un pedido entregado no se reembolsa por falta de existencias';
  }
  if (s.causa === 'cancelacion_antes_listo') {
    if (s.pedido.estado !== 'cancelado') return 'El pedido no está cancelado';
    if (s.pedido.metodoPago !== 'mercado_pago') return 'Solo aplica a pedidos pagados en línea';
    if (s.pedido.llegoAListo) return 'El pedido ya estaba listo para recoger cuando se canceló';
  }
  return null;
}

/** Motivo con el tipo y la causa al inicio: "[Cambio · Producto sellado y sin abrir] detalle". */
export function motivoConPolitica(tipo: TipoDevolucion, causa: CausaDevolucion, detalle?: string | null): string {
  const prefijo = `[${ETIQUETA_TIPO[tipo]} · ${ETIQUETA_CAUSA[causa]}]`;
  const texto = (detalle ?? '').trim();
  return texto ? `${prefijo} ${texto}` : prefijo;
}
