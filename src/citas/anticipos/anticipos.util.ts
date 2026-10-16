import { diasHabilesEntre, sumarDiasHabiles } from '../../common/utils/dias-habiles.util';
import { esDiaValido, inicioDiaMexico } from '../../common/utils/zona-mexico';
import { establecerAnticiposDesdeRegla, reglasDeCita, reglasNegocio, type ReglasCita } from '../../configuracion-sitio/reglas-negocio';
import { leerReferencia, referenciaCitaPago } from '../../ecommerce/mercadopago/referencia-pago';

/**
 * Anticipo de citas: al agendar en línea un servicio con anticipo_monto > 0, la cita guarda la foto del
 * monto y un plazo para pagarlo. Mientras tanto la cita sigue 'pendiente' y aparta el horario; sin pago,
 * la barrida la cancela y lo libera. No hay un estado nuevo en el enum: "pendiente de anticipo" =
 * anticipo_requerido > 0 y anticipo_pagado_en nulo. Dos plazos según cómo elige pagar la clienta:
 * - En línea (Mercado Pago): las horas de la regla citas.plazoAnticipoHoras, pero nunca después de los minutos de
 *   citas.minutosAntesPagoSalon antes del inicio.
 * - En el salón (anticipo_en_salon): hasta citas.minutosAntesPagoSalon antes del inicio.
 * Los valores vigentes salen de Configuración del sitio > Reglas (reglasNegocio(); cada cita guarda los suyos). Estas
 * constantes son los valores de hoy y solo se usan como respaldo y en las pruebas.
 */
export const HORAS_ANTICIPO_CITA = 2;
export const PLAZO_ANTICIPO_MS = HORAS_ANTICIPO_CITA * 60 * 60 * 1000;
export const MINUTOS_ANTES_PAGO_SALON = 15;
export const ANTES_PAGO_SALON_MS = MINUTOS_ANTES_PAGO_SALON * 60 * 1000;

/** Cómo elige pagar el anticipo la clienta al agendar. */
export const PAGOS_ANTICIPO = ['linea', 'salon'] as const;
export type PagoAnticipo = (typeof PAGOS_ANTICIPO)[number];

/**
 * external_reference de Mercado Pago de un anticipo: "<entorno>-cita-<id>" (ver referencia-pago.ts). Las antiguas
 * "cita-<id>" sin prefijo se siguen aceptando.
 */
export const referenciaCita = (citaId: number) => referenciaCitaPago(citaId);
/**
 * Anticipo pagado desde la app móvil: Mercado Pago regresa a RUTA_RETORNO_APP (pública, bajo /api) y
 * esta redirige al deep link fijo con solo el id de la cita, igual que DEEP_LINK_APP en el login con Google.
 */
export const RUTA_RETORNO_APP = 'pagos-en-linea/citas/retorno-app';
export const DEEP_LINK_ANTICIPO_APP = 'appmirufranco://anticipo';
export const deepLinkAnticipoApp = (citaId: number) => `${DEEP_LINK_ANTICIPO_APP}/${citaId}?retorno=mp`;
/** Lo mismo para un pedido de la tienda pagado desde la app: regresa a RUTA_RETORNO_APP_PEDIDO y de ahí al deep link. */
export const RUTA_RETORNO_APP_PEDIDO = 'pagos-en-linea/mercadopago/retorno-app';
export const DEEP_LINK_PEDIDO_APP = 'appmirufranco://pedido';
export const deepLinkPedidoApp = (pedidoId: number) => `${DEEP_LINK_PEDIDO_APP}/${pedidoId}?retorno=mp`;

/** Id de la cita de una referencia de este entorno o antigua sin prefijo; null si no es de una cita de aquí. */
export function citaDeReferencia(referencia: string | null | undefined): number | null {
  const ref = leerReferencia(referencia);
  return ref && ref.tipo === 'cita' && ref.origen !== 'otro_entorno' ? ref.id : null;
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

/** Compatibilidad: fija solo reglas.anticiposDesde en las reglas vigentes (ver configuracion-sitio/reglas-negocio.ts). */
export function establecerAnticiposDesdeConfiguracion(valor: string | null | undefined): void {
  establecerAnticiposDesdeRegla(valor);
}

/**
 * Inicio de los anticipos: la fecha de Configuración del sitio y, si no hay, ANTICIPOS_DESDE (respaldo).
 * 'YYYY-MM-DD' (inicio de ese día en México) o fecha ISO completa, igual que APARTADOS_DESDE. Sin ninguna
 * de las dos la barrida no libera citas, así que tampoco se pide anticipo al agendar (si no, la cita
 * quedaría apartada para siempre).
 */
export function anticiposDesde(): Date | null {
  const valor = (reglasNegocio().anticiposDesde || process.env.ANTICIPOS_DESDE || '').trim();
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return esDiaValido(valor) ? inicioDiaMexico(valor) : null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
export const requiereAnticipo = (cita: { anticipoRequerido?: unknown }) => centavos(cita.anticipoRequerido ?? 0) > 0;

/**
 * Si hoy, al agendar en línea, se pide anticipo para este servicio: tiene monto y ANTICIPOS_DESDE está
 * configurada. Es la regla de CitasService.crear y la que viaja como `anticipoAplica` en GET /servicios.
 */
export const anticipoAplica = (servicio: { anticipoMonto?: unknown }) =>
  requiereAnticipo({ anticipoRequerido: servicio.anticipoMonto }) && anticiposDesde() !== null;

/**
 * Política de anticipos compatible con el art. 56 de la Ley Federal de Protección al Consumidor (la más
 * favorable a la clienta, autorizada por el dueño): si la cita está a MÁS de 10 días hábiles del pago del
 * anticipo, la clienta puede cancelar dentro de los 5 días hábiles siguientes al pago y se le devuelve completo;
 * a 10 días hábiles o menos (excepción de servicios del art. 56), al cancelar no se devuelve (puede reagendar
 * con aviso y el anticipo se respeta). Si cancela el salón, se devuelve completo. Días hábiles: dias-habiles.util.ts.
 */
export const DIAS_HABILES_EXCEPCION_SERVICIO = 10;
export const DIAS_HABILES_CANCELAR_CON_REEMBOLSO = 5;

/** CitasService.cancelar lo emite cuando la clienta cancela a tiempo; AnticiposCitasService reembolsa el pago en línea. */
export const EVENTO_ANTICIPO_REEMBOLSABLE = 'cita.anticipo_reembolsable';

/**
 * El anticipo de una cancelación a tiempo no se reembolsó solo y lo debe devolver el personal: se pagó en el
 * salón, o el reembolso automático en Mercado Pago falló. Lo escucha NotificacionesListener.onAnticipoPorDevolver.
 */
export const EVENTO_ANTICIPO_POR_DEVOLVER = 'cita.anticipo_por_devolver';
export type MotivoAnticipoPorDevolver = 'pagado_en_salon' | 'reembolso_automatico_fallo';

export interface PoliticaCancelacionAnticipo {
  /** Si la clienta cancela en `ahora`, se le devuelve el anticipo completo. */
  reembolsable: boolean;
  /** Fin del plazo para cancelar con reembolso; null si la cita está a 10 días hábiles o menos del pago. */
  reembolsableHasta: Date | null;
  /** Días hábiles entre el pago del anticipo y el inicio de la cita. */
  diasHabilesHastaCita: number;
}

const esFecha = (d: Date | null | undefined): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * null si falta la fecha de pago o de la cita (entonces el anticipo se retiene como siempre). `reglas`: las que se
 * guardaron en la cita al crearla (reglasDeCita); sin ellas, las de hoy. Con aviso mínimo (horas), cancelar con menos
 * aviso no devuelve el anticipo.
 */
export function politicaCancelacionAnticipo(
  pagadoEn: Date | null | undefined,
  inicioCita: Date | null | undefined,
  ahora: Date = new Date(),
  reglas: Pick<ReglasCita, 'diasHabilesExcepcionAnticipo' | 'diasHabilesCancelarConReembolso'> & { diasInhabiles?: string[] } = reglasDeCita(null),
): PoliticaCancelacionAnticipo | null {
  if (!esFecha(pagadoEn) || !esFecha(inicioCita)) return null;
  // Los días inhábiles del salón con que se creó la cita (un día agregado después no cambia su política).
  const inhabiles = reglas.diasInhabiles ?? [];
  // La excepción nunca pasa de los 10 días hábiles de la política publicada; el reembolso, nunca menos de 5 (ley).
  const excepcion = Math.min(DIAS_HABILES_EXCEPCION_SERVICIO, reglas.diasHabilesExcepcionAnticipo);
  const diasReembolso = Math.max(DIAS_HABILES_CANCELAR_CON_REEMBOLSO, reglas.diasHabilesCancelarConReembolso);
  const diasHabilesHastaCita = diasHabilesEntre(pagadoEn, inicioCita, inhabiles);
  if (diasHabilesHastaCita <= excepcion) return { reembolsable: false, reembolsableHasta: null, diasHabilesHastaCita };
  const reembolsableHasta = sumarDiasHabiles(pagadoEn, diasReembolso, inhabiles);
  return { reembolsable: ahora.getTime() <= reembolsableHasta.getTime(), reembolsableHasta, diasHabilesHastaCita };
}
