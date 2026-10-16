import { esDiaValido } from '../common/utils/zona-mexico';

/**
 * Reglas de negocio administrables (Admin > Configuración del sitio > Reglas, sección `reglas` de configuracion_sitio).
 *
 * - Los valores por omisión son los que estaban escritos en el código: desplegar no cambia nada.
 * - El backend las lee siempre con reglasNegocio() (en memoria; ConfiguracionSitioService las carga al arrancar, cada
 *   minuto y al guardar). Las variables de entorno (ANTICIPOS_DESDE, APARTADOS_DESDE) quedan solo de respaldo.
 * - Los plazos de ley no se pueden bajar: revocación (art. 56 LFPC, 5 días hábiles), ARCO (20 y 15 días hábiles) y el
 *   reembolso del anticipo (5 días hábiles).
 * - Cada cita y pedido guarda la regla con la que se creó (instantaneaReglasCita / instantaneaReglasPedido).
 */

export interface DiaInhabil {
  fecha: string;
  motivo: string;
}

export interface ReglasNegocio {
  anticiposDesde: string | null;
  citas: {
    plazoAnticipoHoras: number;
    minutosAntesPagoSalon: number;
    minutosLlegadaAntes: number;
    toleranciaLlegadaMinutos: number;
    porcentajeAnticipoSugerido: number;
    horasAvisoCancelarReagendar: number;
    noAsistio: { pierdeAnticipo: boolean; mesesSoloPagoEnLinea: number };
    maxCitasPorPagarEnSalon: number;
    permitirAnticipoEnSalon: boolean;
    intervaloHorariosMinutos: number;
    recordatoriosHorasAntes: number[];
    diasHabilesExcepcionAnticipo: number;
    diasHabilesCancelarConReembolso: number;
  };
  tienda: {
    apartadosDesde: string | null;
    plazoPagoLineaHoras: number;
    diasPrepararApartado: number;
    diaRecordatorioRecoger: number;
    diasCancelarNoRecogido: number;
    diasResguardoPagado: number;
    tiempoPreparacionTexto: string;
    diasCambioProducto: number;
  };
  revocacion: { diasHabiles: number };
  garantia: { diasServicio: number };
  facturacion: { plazoTexto: string };
  arco: { diasHabilesRespuesta: number; diasHabilesEfectividad: number; diasAvisoVencePronto: number };
  pagos: {
    mercadoPagoTienda: boolean;
    mercadoPagoAnticipos: boolean;
    salon: { efectivo: boolean; tarjeta: boolean; transferencia: boolean };
    transferencia: { banco: string; titular: string; clabe: string };
  };
  diasInhabiles: DiaInhabil[];
}

export const REGLAS_POR_OMISION: ReglasNegocio = {
  anticiposDesde: null,
  citas: {
    plazoAnticipoHoras: 2,
    minutosAntesPagoSalon: 15,
    minutosLlegadaAntes: 20,
    toleranciaLlegadaMinutos: 15,
    porcentajeAnticipoSugerido: 0,
    horasAvisoCancelarReagendar: 0,
    noAsistio: { pierdeAnticipo: true, mesesSoloPagoEnLinea: 6 },
    maxCitasPorPagarEnSalon: 1,
    permitirAnticipoEnSalon: true,
    intervaloHorariosMinutos: 30,
    recordatoriosHorasAntes: [24, 1],
    diasHabilesExcepcionAnticipo: 10,
    diasHabilesCancelarConReembolso: 5,
  },
  tienda: {
    apartadosDesde: null,
    plazoPagoLineaHoras: 24,
    diasPrepararApartado: 3,
    diaRecordatorioRecoger: 3,
    diasCancelarNoRecogido: 7,
    diasResguardoPagado: 15,
    tiempoPreparacionTexto: 'Suele estar listo en 24 a 48 horas hábiles',
    diasCambioProducto: 7,
  },
  revocacion: { diasHabiles: 5 },
  garantia: { diasServicio: 7 },
  facturacion: { plazoTexto: 'dentro del mismo mes de tu compra o servicio' },
  arco: { diasHabilesRespuesta: 20, diasHabilesEfectividad: 15, diasAvisoVencePronto: 5 },
  pagos: {
    mercadoPagoTienda: true,
    mercadoPagoAnticipos: true,
    salon: { efectivo: true, tarjeta: true, transferencia: true },
    transferencia: { banco: '', titular: '', clabe: '' },
  },
  diasInhabiles: [],
};

type TipoRegla = 'entero' | 'booleano' | 'texto' | 'fecha' | 'horas' | 'dias-inhabiles';

/** Definición de una regla: validación, etiqueta y qué afecta (la pantalla de Reglas las muestra tal cual). */
export interface DefinicionRegla {
  ruta: string;
  grupo: 'Citas y anticipos' | 'Tienda y apartados' | 'Plazos legales' | 'Garantía y facturación' | 'Métodos de pago' | 'Días inhábiles';
  etiqueta: string;
  afecta: string;
  tipo: TipoRegla;
  unidad?: string;
  min?: number;
  max?: number;
  /** El mínimo es de ley: el panel no permite menos. */
  minimoLegal?: boolean;
  /** Valores permitidos (por ejemplo, el intervalo de horarios). */
  opciones?: number[];
  maxLargo?: number;
}

export const DEFINICIONES_REGLAS: readonly DefinicionRegla[] = [
  { ruta: 'anticiposDesde', grupo: 'Citas y anticipos', etiqueta: 'Fecha de inicio de los anticipos', afecta: 'Desde esta fecha los servicios con anticipo lo piden al agendar. Vacía: no se pide anticipo en ninguna cita.', tipo: 'fecha' },
  { ruta: 'citas.plazoAnticipoHoras', grupo: 'Citas y anticipos', etiqueta: 'Plazo para pagar el anticipo en línea', afecta: 'Cuánto tiempo queda apartado el horario mientras la clienta paga en línea; después se libera.', tipo: 'entero', unidad: 'horas', min: 1, max: 72 },
  { ruta: 'citas.minutosAntesPagoSalon', grupo: 'Citas y anticipos', etiqueta: 'Pagar el anticipo en el salón hasta', afecta: 'Minutos antes del inicio en que vence el anticipo que se paga en el salón (y tope del pago en línea).', tipo: 'entero', unidad: 'minutos antes', min: 5, max: 240 },
  { ruta: 'citas.minutosLlegadaAntes', grupo: 'Citas y anticipos', etiqueta: 'Llegar antes de la cita', afecta: 'Minutos antes que se pide llegar para pagar el anticipo en el salón. Se muestra en Crear cita y en los Términos.', tipo: 'entero', unidad: 'minutos', min: 0, max: 120 },
  { ruta: 'citas.toleranciaLlegadaMinutos', grupo: 'Citas y anticipos', etiqueta: 'Tolerancia de llegada', afecta: 'Minutos de retraso que se toleran antes de considerar que la clienta no llegó.', tipo: 'entero', unidad: 'minutos', min: 0, max: 60 },
  { ruta: 'citas.porcentajeAnticipoSugerido', grupo: 'Citas y anticipos', etiqueta: 'Porcentaje sugerido del anticipo', afecta: 'Monto que se propone al fijar el anticipo de un servicio en Operaciones (0: sin sugerencia).', tipo: 'entero', unidad: '%', min: 0, max: 100 },
  { ruta: 'citas.horasAvisoCancelarReagendar', grupo: 'Citas y anticipos', etiqueta: 'Aviso mínimo para cancelar o reagendar', afecta: 'Horas antes del inicio. Con menos aviso, la clienta no puede reagendar desde el portal y lo hace con el salón (0: hasta que empiece la cita). No cambia el reembolso del anticipo.', tipo: 'entero', unidad: 'horas', min: 0, max: 168 },
  { ruta: 'citas.noAsistio.pierdeAnticipo', grupo: 'Citas y anticipos', etiqueta: 'Si no llega, pierde el anticipo', afecta: 'Al marcar "no asistió", el anticipo pagado se retiene.', tipo: 'booleano' },
  { ruta: 'citas.noAsistio.mesesSoloPagoEnLinea', grupo: 'Citas y anticipos', etiqueta: 'Después de una falta, solo pago en línea durante', afecta: 'Meses en que una clienta que no llegó (o no pagó en el salón) solo puede pagar su anticipo en línea.', tipo: 'entero', unidad: 'meses', min: 0, max: 24 },
  { ruta: 'citas.maxCitasPorPagarEnSalon', grupo: 'Citas y anticipos', etiqueta: 'Citas por pagar en el salón a la vez', afecta: 'Cuántas citas con el anticipo pendiente de pagar en el salón puede tener una clienta al mismo tiempo.', tipo: 'entero', unidad: 'citas', min: 1, max: 10 },
  { ruta: 'citas.permitirAnticipoEnSalon', grupo: 'Citas y anticipos', etiqueta: 'Permitir pagar el anticipo en el salón', afecta: 'Si se apaga, el anticipo solo se paga en línea.', tipo: 'booleano' },
  { ruta: 'citas.intervaloHorariosMinutos', grupo: 'Citas y anticipos', etiqueta: 'Horarios cada', afecta: 'Cada cuántos minutos se ofrecen horarios para agendar.', tipo: 'entero', unidad: 'minutos', opciones: [15, 20, 30, 60] },
  { ruta: 'citas.recordatoriosHorasAntes', grupo: 'Citas y anticipos', etiqueta: 'Recordatorios de cita', afecta: 'Horas antes de la cita en que se manda un recordatorio (hasta 3).', tipo: 'horas', min: 1, max: 168 },
  { ruta: 'citas.diasHabilesExcepcionAnticipo', grupo: 'Citas y anticipos', etiqueta: 'Anticipo no reembolsable a partir de', afecta: 'Si al pagar el anticipo faltan estos días hábiles o menos para la cita, al cancelar no se devuelve (Política de anticipos). No puede pasar de 10.', tipo: 'entero', unidad: 'días hábiles', min: 0, max: 10 },
  { ruta: 'citas.diasHabilesCancelarConReembolso', grupo: 'Citas y anticipos', etiqueta: 'Plazo para cancelar con reembolso del anticipo', afecta: 'Días hábiles después del pago en que la clienta puede cancelar y recibir su anticipo completo.', tipo: 'entero', unidad: 'días hábiles', min: 5, max: 60, minimoLegal: true },
  { ruta: 'tienda.apartadosDesde', grupo: 'Tienda y apartados', etiqueta: 'Fecha de inicio de la limpieza de apartados', afecta: 'Desde esta fecha se cancelan solos los pedidos sin pagar, sin preparar o sin recoger. Vacía: se usa la variable de respaldo.', tipo: 'fecha' },
  { ruta: 'tienda.plazoPagoLineaHoras', grupo: 'Tienda y apartados', etiqueta: 'Plazo para pagar en línea', afecta: 'Horas para pagar un pedido en línea; después se cancela y vuelve el stock.', tipo: 'entero', unidad: 'horas', min: 1, max: 72 },
  { ruta: 'tienda.diasPrepararApartado', grupo: 'Tienda y apartados', etiqueta: 'Días para preparar un apartado', afecta: 'Si el personal no lo prepara en este tiempo, el apartado se cancela.', tipo: 'entero', unidad: 'días', min: 1, max: 30 },
  { ruta: 'tienda.diaRecordatorioRecoger', grupo: 'Tienda y apartados', etiqueta: 'Recordatorio para recoger', afecta: 'Día (desde que quedó listo) en que se recuerda a la clienta que pase por su pedido.', tipo: 'entero', unidad: 'días', min: 1, max: 30 },
  { ruta: 'tienda.diasCancelarNoRecogido', grupo: 'Tienda y apartados', etiqueta: 'Días para cancelar un apartado no recogido', afecta: 'Si un apartado listo no se recoge en este tiempo, se cancela y vuelve el stock.', tipo: 'entero', unidad: 'días', min: 1, max: 60 },
  { ruta: 'tienda.diasResguardoPagado', grupo: 'Tienda y apartados', etiqueta: 'Resguardo de un pedido pagado', afecta: 'Días que se guarda un pedido pagado en línea para que la clienta lo recoja.', tipo: 'entero', unidad: 'días', min: 1, max: 120 },
  { ruta: 'tienda.tiempoPreparacionTexto', grupo: 'Tienda y apartados', etiqueta: 'Tiempo estimado de preparación', afecta: 'Texto que ve la clienta al elegir recoger en el salón.', tipo: 'texto', maxLargo: 120 },
  { ruta: 'tienda.diasCambioProducto', grupo: 'Tienda y apartados', etiqueta: 'Días para cambios de producto', afecta: 'Días naturales después de recogerlo en que se acepta un cambio.', tipo: 'entero', unidad: 'días', min: 0, max: 90 },
  { ruta: 'revocacion.diasHabiles', grupo: 'Plazos legales', etiqueta: 'Días hábiles para revocar una compra en línea', afecta: 'Plazo para revocar sin dar razones (art. 56 de la Ley Federal de Protección al Consumidor). La ley pide al menos 5.', tipo: 'entero', unidad: 'días hábiles', min: 5, max: 60, minimoLegal: true },
  { ruta: 'arco.diasHabilesRespuesta', grupo: 'Plazos legales', etiqueta: 'Responder una solicitud ARCO en', afecta: 'Plazo para responder (Ley de datos personales: máximo 20 días hábiles; se puede responder antes).', tipo: 'entero', unidad: 'días hábiles', min: 20, max: 20, minimoLegal: true },
  { ruta: 'arco.diasHabilesEfectividad', grupo: 'Plazos legales', etiqueta: 'Hacer efectiva una solicitud ARCO en', afecta: 'Plazo para hacerla efectiva después de responder (máximo legal 15 días hábiles).', tipo: 'entero', unidad: 'días hábiles', min: 15, max: 15, minimoLegal: true },
  { ruta: 'arco.diasAvisoVencePronto', grupo: 'Plazos legales', etiqueta: 'Marcar "vence pronto" a', afecta: 'Días antes del vencimiento en que una solicitud ARCO se marca como "vence pronto" en el panel.', tipo: 'entero', unidad: 'días', min: 1, max: 15 },
  { ruta: 'garantia.diasServicio', grupo: 'Garantía y facturación', etiqueta: 'Garantía de servicios', afecta: 'Días para reportar un servicio que no salió como se esperaba (Garantías y soporte).', tipo: 'entero', unidad: 'días', min: 1, max: 90 },
  { ruta: 'facturacion.plazoTexto', grupo: 'Garantía y facturación', etiqueta: 'Plazo para pedir factura', afecta: 'Se muestra en los Términos y en Facturas.', tipo: 'texto', maxLargo: 120 },
  { ruta: 'pagos.mercadoPagoTienda', grupo: 'Métodos de pago', etiqueta: 'Pago en línea en la tienda (Mercado Pago)', afecta: 'Si se apaga, en el checkout no se ofrece pagar en línea.', tipo: 'booleano' },
  { ruta: 'pagos.mercadoPagoAnticipos', grupo: 'Métodos de pago', etiqueta: 'Pago en línea de anticipos (Mercado Pago)', afecta: 'Si se apaga, el anticipo solo se paga en el salón.', tipo: 'booleano' },
  { ruta: 'pagos.salon.efectivo', grupo: 'Métodos de pago', etiqueta: 'En el salón: efectivo', afecta: 'Se muestra como forma de pago en el salón.', tipo: 'booleano' },
  { ruta: 'pagos.salon.tarjeta', grupo: 'Métodos de pago', etiqueta: 'En el salón: tarjeta', afecta: 'Se muestra como forma de pago en el salón.', tipo: 'booleano' },
  { ruta: 'pagos.salon.transferencia', grupo: 'Métodos de pago', etiqueta: 'En el salón: transferencia', afecta: 'Se muestra como forma de pago en el salón, con los datos de transferencia si están completos.', tipo: 'booleano' },
  { ruta: 'pagos.transferencia.banco', grupo: 'Métodos de pago', etiqueta: 'Banco para transferencias', afecta: 'Se muestra solo si la transferencia está activa.', tipo: 'texto', maxLargo: 60 },
  { ruta: 'pagos.transferencia.titular', grupo: 'Métodos de pago', etiqueta: 'Titular de la cuenta', afecta: 'Se muestra solo si la transferencia está activa.', tipo: 'texto', maxLargo: 120 },
  { ruta: 'pagos.transferencia.clabe', grupo: 'Métodos de pago', etiqueta: 'CLABE interbancaria', afecta: 'Se muestra solo si la transferencia está activa. 18 dígitos.', tipo: 'texto', maxLargo: 18 },
  { ruta: 'diasInhabiles', grupo: 'Días inhábiles', etiqueta: 'Días inhábiles y festivos del salón', afecta: 'Se suman a los domingos y festivos de ley en el cálculo de días hábiles (revocación, anticipos y ARCO).', tipo: 'dias-inhabiles' },
];

const MAX_DIAS_INHABILES = 60;
const MAX_RECORDATORIOS = 3;
const CLABE = /^\d{18}$/;

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const leer = (obj: unknown, ruta: string): unknown => ruta.split('.').reduce<unknown>((o, k) => (esObjeto(o) ? o[k] : undefined), obj);
function escribir(obj: Record<string, unknown>, ruta: string, valor: unknown) {
  const partes = ruta.split('.');
  let o = obj;
  for (const k of partes.slice(0, -1)) {
    if (!esObjeto(o[k])) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[partes[partes.length - 1]] = valor;
}
const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Valor válido de una regla, o un mensaje de error en español. */
function validarValor(d: DefinicionRegla, v: unknown): { valor?: unknown; error?: string } {
  const nombre = d.etiqueta.toLowerCase();
  switch (d.tipo) {
    case 'booleano':
      return typeof v === 'boolean' ? { valor: v } : { error: `"${d.etiqueta}" debe ser sí o no.` };
    case 'texto': {
      if (typeof v !== 'string') return { error: `"${d.etiqueta}" debe ser texto.` };
      const t = v.trim();
      if (d.maxLargo && t.length > d.maxLargo) return { error: `"${d.etiqueta}" tiene como máximo ${d.maxLargo} caracteres.` };
      return { valor: t };
    }
    case 'fecha': {
      if (v === null || v === '' || v === undefined) return { valor: null };
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !esDiaValido(v)) return { error: `La ${nombre} debe ser una fecha válida (AAAA-MM-DD).` };
      return { valor: v };
    }
    case 'entero': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `"${d.etiqueta}" debe ser un número entero.` };
      if (!Number.isInteger(v)) return { error: `"${d.etiqueta}" debe ser un número entero.` };
      if (d.opciones && !d.opciones.includes(v)) return { error: `"${d.etiqueta}": elige ${d.opciones.join(', ')} minutos (horarios).` };
      if (d.min !== undefined && v < d.min) {
        return {
          error: d.minimoLegal
            ? `"${d.etiqueta}": la ley pide al menos ${d.min} ${d.unidad ?? ''}.`.replace(' .', '.')
            : `"${d.etiqueta}" debe ser de al menos ${d.min} ${d.unidad ?? ''}.`.replace(' .', '.'),
        };
      }
      if (d.max !== undefined && v > d.max) {
        return {
          error: d.minimoLegal && d.min === d.max
            ? `"${d.etiqueta}": el plazo de ley es de ${d.max} ${d.unidad ?? ''}.`.replace(' .', '.')
            : `"${d.etiqueta}" debe ser de como máximo ${d.max} ${d.unidad ?? ''}.`.replace(' .', '.'),
        };
      }
      return { valor: v };
    }
    case 'horas': {
      if (!Array.isArray(v) || v.length > MAX_RECORDATORIOS || !v.every((h) => Number.isInteger(h) && h >= (d.min ?? 1) && h <= (d.max ?? 168))) {
        return { error: `"${d.etiqueta}": hasta ${MAX_RECORDATORIOS} recordatorios, cada uno de ${d.min} a ${d.max} horas antes.` };
      }
      return { valor: [...new Set(v as number[])].sort((a, b) => b - a) };
    }
    case 'dias-inhabiles': {
      if (!Array.isArray(v) || v.length > MAX_DIAS_INHABILES) return { error: `Días inhábiles: una lista de hasta ${MAX_DIAS_INHABILES} días.` };
      const lista: DiaInhabil[] = [];
      for (const [i, d0] of v.entries()) {
        const fecha = esObjeto(d0) ? d0.fecha : undefined;
        const motivo = esObjeto(d0) && typeof d0.motivo === 'string' ? d0.motivo.trim() : '';
        if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !esDiaValido(fecha)) return { error: `Día inhábil ${i + 1}: la fecha debe ser válida (AAAA-MM-DD).` };
        if (motivo.length > 80) return { error: `Día inhábil ${i + 1}: el motivo tiene como máximo 80 caracteres.` };
        if (!lista.some((x) => x.fecha === fecha)) lista.push({ fecha, motivo });
      }
      return { valor: lista.sort((a, b) => a.fecha.localeCompare(b.fecha)) };
    }
  }
}

/** Campos permitidos por objeto (para avisar de campos que no se reconocen). */
function camposPermitidos(): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const d of DEFINICIONES_REGLAS) {
    const partes = d.ruta.split('.');
    for (let i = 0; i < partes.length; i++) {
      const padre = partes.slice(0, i).join('.');
      if (!mapa.has(padre)) mapa.set(padre, new Set());
      mapa.get(padre)!.add(partes[i]);
    }
  }
  return mapa;
}
const PERMITIDOS = camposPermitidos();

function camposDesconocidos(valor: unknown, ruta = ''): string[] {
  if (!esObjeto(valor)) return [];
  const permitidos = PERMITIDOS.get(ruta);
  if (!permitidos) return [];
  const extra: string[] = [];
  for (const [k, v] of Object.entries(valor)) {
    const r = ruta ? `${ruta}.${k}` : k;
    if (!permitidos.has(k)) extra.push(r);
    else if (esObjeto(v) && PERMITIDOS.has(r)) extra.push(...camposDesconocidos(v, r));
  }
  return extra;
}

/**
 * Valida lo que manda el panel. Lo que no viene se completa con lo actual por omisión (así lo guardado hoy, solo
 * `anticiposDesde`, sigue siendo válido). Devuelve las reglas completas y los errores en español.
 */
export function validarReglas(valor: unknown, base: ReglasNegocio = REGLAS_POR_OMISION): { limpio: ReglasNegocio; errores: string[] } {
  const errores: string[] = [];
  const limpio = clonar(base) as unknown as Record<string, unknown>;
  if (!esObjeto(valor)) return { limpio: limpio as unknown as ReglasNegocio, errores: ['Las reglas deben ser un objeto.'] };
  const extra = camposDesconocidos(valor);
  if (extra.length) errores.push(`Estos campos no se reconocen: ${extra.join(', ')}.`);
  for (const d of DEFINICIONES_REGLAS) {
    const v = leer(valor, d.ruta);
    if (v === undefined) continue;
    const r = validarValor(d, v);
    if (r.error) errores.push(r.error);
    else escribir(limpio, d.ruta, r.valor);
  }
  const reglas = limpio as unknown as ReglasNegocio;
  if (reglas.tienda.diaRecordatorioRecoger >= reglas.tienda.diasCancelarNoRecogido) {
    errores.push('El recordatorio para recoger debe ser antes del día en que se cancela el apartado no recogido.');
  }
  if (!reglas.pagos.mercadoPagoAnticipos && !reglas.citas.permitirAnticipoEnSalon) {
    errores.push('El anticipo necesita al menos una forma de pago: en línea o en el salón.');
  }
  if (reglas.citas.permitirAnticipoEnSalon && !reglas.pagos.mercadoPagoAnticipos && metodosSalonActivos(reglas).length === 0) {
    errores.push('Activa al menos un método de pago en el salón o el pago en línea de anticipos.');
  }
  const t = reglas.pagos.transferencia;
  if (t.banco || t.titular || t.clabe) {
    if (!t.banco || !t.titular) errores.push('Para mostrar los datos de transferencia escribe el banco y el titular.');
    if (!CLABE.test(t.clabe)) errores.push('La CLABE debe tener 18 dígitos.');
  }
  return { limpio: reglas, errores };
}

/** Lo guardado, ya completo. Un valor inválido (por ejemplo, editado a mano en la base) usa el de hoy. */
/** Reglas completas a partir de lo guardado en la base (lo inválido o lo que falta, con los valores de hoy). */
export function reglasDesdeGuardado(guardado: unknown): ReglasNegocio {
  return completar(guardado);
}

function completar(guardado: unknown): ReglasNegocio {
  const reglas = clonar(REGLAS_POR_OMISION) as unknown as Record<string, unknown>;
  if (!esObjeto(guardado)) return reglas as unknown as ReglasNegocio;
  for (const d of DEFINICIONES_REGLAS) {
    const v = leer(guardado, d.ruta);
    if (v === undefined) continue;
    const r = validarValor(d, v);
    if (!r.error) escribir(reglas, d.ruta, r.valor);
  }
  const completas = reglas as unknown as ReglasNegocio;
  if (completas.tienda.diaRecordatorioRecoger >= completas.tienda.diasCancelarNoRecogido) {
    completas.tienda.diaRecordatorioRecoger = REGLAS_POR_OMISION.tienda.diaRecordatorioRecoger;
    completas.tienda.diasCancelarNoRecogido = REGLAS_POR_OMISION.tienda.diasCancelarNoRecogido;
  }
  return completas;
}

let vigentes: ReglasNegocio = clonar(REGLAS_POR_OMISION);

/** La pone ConfiguracionSitioService al arrancar, cada minuto y al guardar. null: los valores de hoy. */
export function establecerReglasNegocio(guardado: unknown): void {
  vigentes = completar(guardado);
}

/** Reglas vigentes (siempre completas). */
export function reglasNegocio(): ReglasNegocio {
  return vigentes;
}

/** Fija solo la fecha de inicio de los anticipos (compatibilidad con establecerAnticiposDesdeConfiguracion). */
export function establecerAnticiposDesdeRegla(valor: string | null | undefined): void {
  vigentes = { ...vigentes, anticiposDesde: valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) && esDiaValido(valor) ? valor : valor ?? null };
}

/** Lo que se guarda en la cita al crearla: así un cambio de regla no afecta a las citas ya agendadas. */
export interface ReglasCita {
  plazoAnticipoHoras: number;
  minutosAntesPagoSalon: number;
  horasAvisoCancelarReagendar: number;
  diasHabilesExcepcionAnticipo: number;
  diasHabilesCancelarConReembolso: number;
  pierdeAnticipoSiNoAsiste: boolean;
  /** Días inhábiles del salón al crearla (YYYY-MM-DD): los plazos de días hábiles de la cita usan estos. */
  diasInhabiles: string[];
}
export function instantaneaReglasCita(r: ReglasNegocio = vigentes): ReglasCita {
  return {
    plazoAnticipoHoras: r.citas.plazoAnticipoHoras,
    minutosAntesPagoSalon: r.citas.minutosAntesPagoSalon,
    horasAvisoCancelarReagendar: r.citas.horasAvisoCancelarReagendar,
    diasHabilesExcepcionAnticipo: r.citas.diasHabilesExcepcionAnticipo,
    diasHabilesCancelarConReembolso: r.citas.diasHabilesCancelarConReembolso,
    pierdeAnticipoSiNoAsiste: r.citas.noAsistio.pierdeAnticipo,
    diasInhabiles: r.diasInhabiles.map((d) => d.fecha),
  };
}

/** Lo que se guarda en el pedido al crearlo. */
export interface ReglasPedido {
  plazoPagoLineaHoras: number;
  diasPrepararApartado: number;
  diaRecordatorioRecoger: number;
  diasCancelarNoRecogido: number;
  diasResguardoPagado: number;
  diasCambioProducto: number;
  diasHabilesRevocacion: number;
  /** Días inhábiles del salón al crearlo (YYYY-MM-DD): el plazo de revocación usa estos. */
  diasInhabiles: string[];
}
export function instantaneaReglasPedido(r: ReglasNegocio = vigentes): ReglasPedido {
  return {
    plazoPagoLineaHoras: r.tienda.plazoPagoLineaHoras,
    diasPrepararApartado: r.tienda.diasPrepararApartado,
    diaRecordatorioRecoger: r.tienda.diaRecordatorioRecoger,
    diasCancelarNoRecogido: r.tienda.diasCancelarNoRecogido,
    diasResguardoPagado: r.tienda.diasResguardoPagado,
    diasCambioProducto: r.tienda.diasCambioProducto,
    diasHabilesRevocacion: r.revocacion.diasHabiles,
    diasInhabiles: r.diasInhabiles.map((d) => d.fecha),
  };
}

/**
 * Reglas guardadas en una cita o pedido, completas: lo que falte (citas y pedidos anteriores a esta ronda) se toma de
 * los valores por omisión, que son los que regían cuando se crearon.
 */
export function reglasDeCita(guardadas: unknown): ReglasCita {
  const base = instantaneaReglasCita(REGLAS_POR_OMISION);
  return esObjeto(guardadas) ? ({ ...base, ...filtrarNumerosYBooleanos(guardadas, base) } as ReglasCita) : base;
}
export function reglasDePedido(guardadas: unknown): ReglasPedido {
  const base = instantaneaReglasPedido(REGLAS_POR_OMISION);
  return esObjeto(guardadas) ? ({ ...base, ...filtrarNumerosYBooleanos(guardadas, base) } as ReglasPedido) : base;
}
function filtrarNumerosYBooleanos(obj: Record<string, unknown>, base: object): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    const g = obj[k];
    if (Array.isArray(v)) {
      if (Array.isArray(g) && g.every((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x))) salida[k] = [...g];
    } else if (typeof g === typeof v && (typeof g !== 'number' || Number.isFinite(g))) salida[k] = g;
  }
  return salida;
}

/** Métodos de pago en el salón activos, en el orden en que se muestran. */
export function metodosSalonActivos(r: ReglasNegocio = vigentes): Array<'efectivo' | 'tarjeta' | 'transferencia'> {
  return (['efectivo', 'tarjeta', 'transferencia'] as const).filter((m) => r.pagos.salon[m]);
}

/**
 * Variables para los textos del sitio y los documentos legales ({plazoAnticipoHoras}, {diasResguardo}...). Siempre
 * texto, ya con el valor vigente.
 */
export function variablesDeReglas(r: ReglasNegocio = vigentes): Record<string, string> {
  return {
    plazoAnticipoHoras: String(r.citas.plazoAnticipoHoras),
    minutosAntesPagoSalon: String(r.citas.minutosAntesPagoSalon),
    minutosLlegadaAntes: String(r.citas.minutosLlegadaAntes),
    toleranciaLlegadaMinutos: String(r.citas.toleranciaLlegadaMinutos),
    horasAvisoCancelarReagendar: String(r.citas.horasAvisoCancelarReagendar),
    mesesSoloPagoEnLinea: String(r.citas.noAsistio.mesesSoloPagoEnLinea),
    diasHabilesExcepcionAnticipo: String(r.citas.diasHabilesExcepcionAnticipo),
    diasHabilesCancelarConReembolso: String(r.citas.diasHabilesCancelarConReembolso),
    plazoPagoLineaHoras: String(r.tienda.plazoPagoLineaHoras),
    diasPrepararApartado: String(r.tienda.diasPrepararApartado),
    diaRecordatorioRecoger: String(r.tienda.diaRecordatorioRecoger),
    diasCancelarNoRecogido: String(r.tienda.diasCancelarNoRecogido),
    diasRestantesRecoger: String(r.tienda.diasCancelarNoRecogido - r.tienda.diaRecordatorioRecoger),
    diasResguardo: String(r.tienda.diasResguardoPagado),
    tiempoPreparacion: r.tienda.tiempoPreparacionTexto,
    diasCambioProducto: String(r.tienda.diasCambioProducto),
    diasHabilesRevocacion: String(r.revocacion.diasHabiles),
    diasGarantia: String(r.garantia.diasServicio),
    plazoFactura: r.facturacion.plazoTexto,
    diasHabilesArcoRespuesta: String(r.arco.diasHabilesRespuesta),
    diasHabilesArcoEfectividad: String(r.arco.diasHabilesEfectividad),
  };
}

/** Nombres de las variables (para validar los textos y documentos que las usan). */
export const VARIABLES_REGLAS = Object.freeze(Object.keys(variablesDeReglas(REGLAS_POR_OMISION)));
