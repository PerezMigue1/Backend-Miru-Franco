import { VARIABLES_REGLAS } from '../configuracion-sitio/reglas-negocio';

/**
 * Catálogo de textos del sitio (Admin > Textos del sitio). Cada texto tiene una clave estable, la página donde se ve,
 * una descripción para la dueña, el valor por defecto (el texto exacto de hoy), su largo máximo, su tipo y las
 * variables que puede usar entre llaves: las de las reglas de negocio ({plazoAnticipoHoras}, {diasResguardo}...) y
 * las de contexto de ese texto ({servicio}, {fecha}, {pedido}...).
 *
 * - Lo que la dueña cambia se guarda en la tabla textos_sitio (la migración siembra una fila por clave con el valor de
 *   hoy); si una clave no tiene fila, se usa el valor por defecto. Desplegar no cambia nada de lo que se ve.
 * - Se quedan en el código las etiquetas genéricas de los controles (Guardar, Cancelar, Siguiente), los mensajes de
 *   validación de formularios y los textos de las casillas de consentimiento (son evidencia legal ligada a una versión
 *   publicada: TEXTO_POLITICA_ANTICIPOS, casillas de compra, TEXTO_FOTOS_RESULTADO).
 * - Los textos de tipo 'texto' son públicos (GET /api/configuracion-publica, campo textos); los de correo y avisos
 *   internos nunca salen del backend.
 * - La web guarda una copia de los valores por defecto en src/app/utils/textosSitio.ts (miru-franco-web); la prueba
 *   catalogo.spec.ts revisa que no se separen.
 */

export type TipoTexto = 'texto' | 'correo-asunto' | 'correo-cuerpo' | 'aviso-titulo' | 'aviso-mensaje';

export type PaginaTexto =
  | 'Crear cita'
  | 'Confirmación de cita'
  | 'Mis citas'
  | 'Cancelar cita'
  | 'Anticipos'
  | 'Checkout'
  | 'Mis pedidos'
  | 'Garantías'
  | 'Devoluciones'
  | 'Correos'
  | 'Avisos internos';

export const PAGINAS_TEXTOS: readonly PaginaTexto[] = [
  'Crear cita',
  'Confirmación de cita',
  'Mis citas',
  'Cancelar cita',
  'Anticipos',
  'Checkout',
  'Mis pedidos',
  'Garantías',
  'Devoluciones',
  'Correos',
  'Avisos internos',
];

/** Variables de contexto: las llena quien muestra el texto (la web, el correo o el aviso). */
export const VARIABLES_CONTEXTO: Readonly<Record<string, { descripcion: string; ejemplo: string }>> = {
  nombreSalon: { descripcion: 'Nombre del salón (Configuración del sitio)', ejemplo: 'Mirú Franco Salón Beauty' },
  servicio: { descripcion: 'Nombre del servicio', ejemplo: 'Corte y peinado' },
  fecha: { descripcion: 'Fecha y hora', ejemplo: '28 oct 2026, 11:00' },
  motivo: { descripcion: 'Motivo que se escribió', ejemplo: 'Cambio de planes' },
  cita: { descripcion: 'Número de la cita', ejemplo: '128' },
  pedido: { descripcion: 'Número del pedido', ejemplo: '57' },
  folio: { descripcion: 'Folio', ejemplo: 'V-00045' },
  monto: { descripcion: 'Monto en pesos', ejemplo: '$450.00' },
  clienta: { descripcion: 'Nombre de la clienta', ejemplo: 'Ana López' },
  tipoArco: { descripcion: 'Tipo de solicitud ARCO', ejemplo: 'acceso' },
  estadoArco: { descripcion: 'Qué pasó con la solicitud ARCO', ejemplo: 'ya tiene respuesta' },
  minutos: { descripcion: 'Minutos de vigencia', ejemplo: '10' },
  fechaHora: { descripcion: 'Fecha y hora del cambio', ejemplo: '16 de octubre de 2026, 10:30' },
  correoNuevo: { descripcion: 'Correo nuevo que se pidió', ejemplo: 'ana@ejemplo.com' },
  enlaceRecuperar: { descripcion: 'Enlace para recuperar la cuenta', ejemplo: '¿Olvidaste tu contraseña?' },
  plazoAnticipo: { descripcion: 'Plazo para pagar el anticipo en línea de esta cita', ejemplo: '2 horas' },
  limite: { descripcion: 'Fecha límite del anticipo, si falta más de un día', ejemplo: ' (paga antes del miércoles 28 de octubre, 11:15 a.m.)' },
  formasPago: { descripcion: 'Formas de pagar el anticipo que están activas', ejemplo: 'en línea o en el salón' },
  metodosSalon: { descripcion: 'Métodos de pago activos en el salón', ejemplo: 'efectivo, tarjeta o transferencia' },
  mesesSoloLinea: { descripcion: 'Meses con pago solo en línea después de una falta', ejemplo: '6 meses' },
  horasAviso: { descripcion: 'Aviso mínimo para cancelar o reagendar', ejemplo: '24 horas' },
  precio: { descripcion: 'Precio del servicio', ejemplo: '$450.00' },
  saldo: { descripcion: 'Lo que queda por pagar en el salón', ejemplo: '$300.00' },
  total: { descripcion: 'Total del pedido', ejemplo: '$890.00' },
  plazoPago: { descripcion: 'Horas para pagar este pedido en línea', ejemplo: '24' },
  anticipo: { descripcion: 'Monto del anticipo', ejemplo: '$150.00' },
  fechaLimite: { descripcion: 'Último día para cancelar con reembolso', ejemplo: 'jueves, 22 de octubre de 2026' },
  diasExcepcion: { descripcion: 'Días hábiles de la excepción del anticipo de esta cita', ejemplo: '10' },
  diasReembolso: { descripcion: 'Días hábiles para cancelar con reembolso en esta cita', ejemplo: '5' },
  diasRevocacion: { descripcion: 'Días hábiles para revocar este pedido', ejemplo: '5' },
};

export interface DefinicionTexto {
  clave: string;
  pagina: PaginaTexto;
  descripcion: string;
  porDefecto: string;
  max: number;
  tipo: TipoTexto;
  /** Variables de contexto que este texto puede usar (además de todas las de reglas). */
  contexto: readonly string[];
}

const MAX_POR_TIPO: Record<TipoTexto, number> = {
  texto: 300,
  'correo-asunto': 120,
  'correo-cuerpo': 1200,
  'aviso-titulo': 80,
  'aviso-mensaje': 300,
};

type Opciones = { max?: number; contexto?: string[]; tipo?: TipoTexto };

function d(clave: string, pagina: PaginaTexto, descripcion: string, porDefecto: string, o: Opciones = {}): DefinicionTexto {
  const tipo = o.tipo ?? 'texto';
  return { clave, pagina, descripcion, porDefecto, tipo, max: o.max ?? MAX_POR_TIPO[tipo], contexto: Object.freeze(o.contexto ?? []) };
}
const boton = (clave: string, pagina: PaginaTexto, descripcion: string, porDefecto: string) => d(clave, pagina, descripcion, porDefecto, { max: 40 });
const asunto = (clave: string, descripcion: string, porDefecto: string, contexto: string[] = []) =>
  d(clave, 'Correos', descripcion, porDefecto, { tipo: 'correo-asunto', contexto: ['nombreSalon', ...contexto] });
const cuerpo = (clave: string, descripcion: string, porDefecto: string, contexto: string[] = []) =>
  d(clave, 'Correos', descripcion, porDefecto, { tipo: 'correo-cuerpo', contexto: ['nombreSalon', ...contexto] });
const titulo = (clave: string, descripcion: string, porDefecto: string) => d(clave, 'Avisos internos', descripcion, porDefecto, { tipo: 'aviso-titulo' });
const mensaje = (clave: string, descripcion: string, porDefecto: string, contexto: string[] = []) =>
  d(clave, 'Avisos internos', descripcion, porDefecto, { tipo: 'aviso-mensaje', contexto });

const CTX_PEDIDO = ['pedido'];
const CTX_CITA = ['servicio', 'fecha', 'cita'];

export const CATALOGO_TEXTOS: readonly DefinicionTexto[] = Object.freeze([
  // --- Crear cita ---
  d('citas.crear.sinDatosTitulo', 'Crear cita', 'Título cuando la clienta entra sin haber elegido servicio y horario.', 'Aún no has elegido un servicio y horario', { max: 80 }),
  d('citas.crear.sinDatosTexto', 'Crear cita', 'Explicación de qué falta para confirmar la cita.', 'Elige el servicio que quieres, luego el especialista, el día y la hora. Después vuelves aquí para confirmar.'),
  d('citas.crear.tituloConfirmar', 'Crear cita', 'Título del bloque con la forma de pago y el botón final.', 'Confirma tu cita', { max: 60 }),
  d('citas.crear.anticipoDescuentoSaldo', 'Crear cita', 'Debajo del anticipo en el resumen, cuando se conoce el precio.', 'Se descuenta del total: el día de tu cita pagas {saldo} en el salón.', { contexto: ['saldo'] }),
  d('citas.crear.anticipoDescuento', 'Crear cita', 'Debajo del anticipo en el resumen, sin precio conocido.', 'Se descuenta del total el día de tu cita.'),
  boton('citas.crear.botonConfirmar', 'Crear cita', 'Botón final cuando el servicio no pide anticipo.', 'Confirmar cita'),
  boton('citas.crear.botonConfirmarLinea', 'Crear cita', 'Botón final cuando se paga el anticipo en línea.', 'Confirmar y pagar anticipo'),
  boton('citas.crear.botonConfirmarSalon', 'Crear cita', 'Botón final cuando se paga el anticipo en el salón.', 'Confirmar y pagar en el salón'),
  d('citas.formaPago.anticipoEtiqueta', 'Crear cita', 'Etiqueta del monto del anticipo en "Forma de pago".', 'Anticipo para apartar tu cita', { max: 60 }),
  d('citas.formaPago.saldoEtiqueta', 'Crear cita', 'Etiqueta de lo que se paga en el salón en "Forma de pago".', 'Pagas en el salón el día de tu cita', { max: 60 }),
  d('citas.formaPago.pregunta', 'Crear cita', 'Pregunta sobre las opciones para pagar el anticipo.', '¿Cómo quieres pagar el anticipo?', { max: 80 }),
  boton('citas.formaPago.opcionLinea', 'Crear cita', 'Opción para pagar el anticipo en línea.', 'Pagar anticipo en línea'),
  boton('citas.formaPago.opcionSalon', 'Crear cita', 'Opción para pagar el anticipo en el salón.', 'Pagar anticipo en el salón'),
  d('citas.formaPago.plazoLinea', 'Crear cita', 'Plazo de la opción en línea.', 'Con Mercado Pago. Tienes {plazoAnticipo} para pagarlo, sin pasar de {minutosAntesPagoSalon} minutos antes de tu cita; si no, el horario se libera.', { contexto: ['plazoAnticipo'] }),
  d('citas.formaPago.llegadaSalon', 'Crear cita', 'Cuándo llegar para pagar en el salón (solo si se pide llegar antes del plazo).', 'Llega entre {minutosLlegadaAntes} y {minutosAntesPagoSalon} minutos antes para pagarlo.'),
  d('citas.formaPago.plazoSalon', 'Crear cita', 'Qué pasa si no se paga en el salón a tiempo.', 'Si a {minutosAntesPagoSalon} minutos de tu cita no se ha pagado, la cita se cancela.'),
  d('citas.formaPago.noAsistePierde', 'Crear cita', 'Consecuencia de no llegar cuando el anticipo se retiene.', 'Si no llegas a tu cita y no avisas, el anticipo no se devuelve.'),
  d('citas.formaPago.noAsisteRevisa', 'Crear cita', 'Consecuencia de no llegar cuando el anticipo no se retiene.', 'Si no llegas a tu cita, el salón revisa la devolución de tu anticipo.'),
  d('citas.formaPago.soloLineaDespuesFalta', 'Crear cita', 'Qué pasa con las siguientes citas después de una falta.', 'Durante {mesesSoloLinea}, tus próximas citas se apartan pagando el anticipo en línea.', { contexto: ['mesesSoloLinea'] }),
  d('citas.formaPago.avisoCancelar', 'Crear cita', 'Aviso mínimo para reagendar desde la cuenta (solo si la regla lo pide; no cambia el reembolso).', 'Para reagendar desde tu cuenta avisa con al menos {horasAviso} de anticipación; con menos aviso, reagenda con el salón.', { contexto: ['horasAviso'] }),
  d('citas.formaPago.metodosSalon', 'Crear cita', 'Métodos de pago del salón (también en Mis citas).', 'En el salón puedes pagar con {metodosSalon}.', { contexto: ['metodosSalon'] }),
  d('citas.formaPago.sinAnticipoPrecio', 'Crear cita', 'Servicio sin anticipo con precio conocido (también en Mis citas).', 'Pagas {precio} en el salón el día de tu cita.', { contexto: ['precio'] }),
  d('citas.formaPago.sinAnticipo', 'Crear cita', 'Servicio sin anticipo sin precio conocido.', 'Pagas tu servicio en el salón el día de tu cita.'),

  // --- Confirmación de cita ---
  d('citas.confirmacion.titulo', 'Confirmación de cita', 'Mensaje principal al terminar de agendar.', 'Tu cita ha sido agendada exitosamente', { max: 80 }),
  d('citas.recordatorio', 'Confirmación de cita', 'Aviso de recordatorios (confirmación y detalle de la cita).', 'Antes de tu cita te mandaremos un recordatorio en tu cuenta y, si lo tienes activado, por correo.'),

  // --- Mis citas ---
  d('citas.lista.vacia', 'Mis citas', 'Lista de citas vacía.', 'No tienes citas agendadas', { max: 80 }),
  d('citas.lista.sinResultados', 'Mis citas', 'Búsqueda sin resultados.', 'No hay citas que coincidan con tu búsqueda', { max: 80 }),
  d('citas.pagoSalon.saldo', 'Mis citas', 'Detalle de la cita: saldo a pagar en el salón después del anticipo.', 'El día de tu cita pagas en el salón {saldo} (el total menos tu anticipo).', { contexto: ['saldo'] }),
  d('citas.pagoSalon.saldoSinPrecio', 'Mis citas', 'Detalle de la cita: saldo sin precio conocido.', 'El día de tu cita pagas en el salón el total menos tu anticipo.'),

  // --- Cancelar cita ---
  d('citas.cancelar.sinAnticipo', 'Cancelar cita', 'Cancelar una cita sin anticipo pagado.', 'Como no has pagado anticipo, cancelar no tiene costo. Si solo necesitas otro horario, te recomendamos reprogramarla.'),
  d('citas.cancelar.avisoReagendar', 'Cancelar cita', 'Se agrega cuando la regla pide aviso mínimo para reagendar.', 'Para reagendar desde tu cuenta avisa con al menos {horasAviso} de anticipación.', { contexto: ['horasAviso'] }),
  d('citas.cancelar.anticipoSinDatos', 'Cancelar cita', 'Anticipo pagado cuando no se pudo consultar su política.', 'Si tu cita está a más de {diasExcepcion} días hábiles de la fecha en que pagaste tu anticipo de {anticipo} y cancelas dentro de los {diasReembolso} días hábiles siguientes a tu pago, te lo devolvemos completo; en otro caso no se devuelve.', { contexto: ['anticipo', 'diasExcepcion', 'diasReembolso'] }),
  d('citas.cancelar.anticipoReembolsable', 'Cancelar cita', 'Anticipo pagado que todavía se devuelve.', 'Si cancelas ahora, te devolvemos completo tu anticipo de {anticipo} por el mismo medio con el que lo pagaste: tu cita está a más de {diasExcepcion} días hábiles de tu pago y cancelas dentro de los {diasReembolso} días hábiles siguientes.', { contexto: ['anticipo', 'diasExcepcion', 'diasReembolso'] }),
  d('citas.cancelar.anticipoHasta', 'Cancelar cita', 'Se agrega al anterior con el último día para cancelar con reembolso.', 'Tienes hasta el {fechaLimite}.', { contexto: ['fechaLimite'] }),
  d('citas.cancelar.anticipoPlazoTerminado', 'Cancelar cita', 'Anticipo pagado cuyo plazo de reembolso ya terminó.', 'Tu anticipo de {anticipo} ya no se devuelve si cancelas: el plazo para cancelar con reembolso terminó el {fechaLimite}.', { contexto: ['anticipo', 'fechaLimite'] }),
  d('citas.cancelar.anticipoNoReembolsable', 'Cancelar cita', 'Anticipo pagado que no se devuelve por la excepción de días.', 'Tu anticipo de {anticipo} no se devuelve si cancelas, porque tu cita está a {diasExcepcion} días hábiles o menos de la fecha en que lo pagaste.', { contexto: ['anticipo', 'diasExcepcion'] }),
  d('citas.cancelar.reprogramar', 'Cancelar cita', 'Sugerencia de reprogramar cuando el anticipo no se devuelve.', 'Si reprogramas tu cita con aviso, tu anticipo se respeta para la nueva fecha.'),
  d('citas.cancelar.toast', 'Cancelar cita', 'Aviso al terminar de cancelar.', 'Tu cita quedó cancelada.', { max: 120 }),
  d('citas.cancelar.toastReembolso', 'Cancelar cita', 'Aviso al terminar de cancelar con reembolso del anticipo.', 'Tu cita quedó cancelada. Te devolvemos tu anticipo completo por el mismo medio con el que lo pagaste.', { max: 160 }),

  // --- Anticipos (Mis citas y confirmación) ---
  d('anticipos.sinAnticipo', 'Anticipos', 'En la lista de citas, cuando el servicio no pide anticipo.', 'Sin anticipo', { max: 40 }),
  boton('anticipos.botonPagar', 'Anticipos', 'Botón en la lista de citas para ir a pagar el anticipo.', 'Pagar anticipo'),
  boton('anticipos.botonMercadoPago', 'Anticipos', 'Botón para pagar el anticipo en línea.', 'Pagar anticipo con Mercado Pago'),
  boton('anticipos.botonSalon', 'Anticipos', 'Botón para cambiar a pago en el salón.', 'Pagar en el salón'),
  d('anticipos.enlacePolitica', 'Anticipos', 'Enlace a la política de anticipos.', 'Leer la Política de anticipos y cancelación', { max: 80 }),
  d('anticipos.pendiente', 'Anticipos', 'Detalle de la cita con anticipo por pagar en línea.', 'Págalo {formasPago}. Si no se paga en {plazoAnticipo}, el horario se libera.', { contexto: ['formasPago', 'plazoAnticipo'] }),
  d('anticipos.plazoLinea', 'Anticipos', 'Advertencia junto a los botones de pago en línea.', 'Tienes {plazoAnticipo} para pagarlo en línea{limite}; si no, el horario se libera.', { contexto: ['plazoAnticipo', 'limite'] }),
  d('anticipos.salonSeLibera', 'Anticipos', 'Se agrega al plazo del pago en el salón.', 'Si no lo pagas a tiempo, el horario se libera.'),
  d('anticipos.pagado', 'Anticipos', 'Anticipo pagado.', 'Se descuenta del total el día de tu cita.'),
  d('anticipos.enRevision', 'Anticipos', 'Anticipo en revisión.', 'El salón está revisando tu anticipo; te avisaremos en tu cuenta.'),
  d('anticipos.liberada', 'Anticipos', 'Anticipo no pagado a tiempo.', 'No recibimos el anticipo a tiempo y el horario se liberó.'),
  d('anticipos.retenido', 'Anticipos', 'Anticipo retenido por no asistir.', 'La cita no se atendió y el anticipo se retuvo, como indican los términos.'),
  d('anticipos.devuelto', 'Anticipos', 'Anticipo devuelto.', 'Te devolvimos el anticipo.'),

  // --- Checkout ---
  d('checkout.recogerTitulo', 'Checkout', 'Paso 1: título.', 'Recoges tu pedido en el salón', { max: 80 }),
  d('checkout.recogerTexto', 'Checkout', 'Paso 1: explicación.', 'Lo preparamos y te lo apartamos en el mostrador.'),
  d('checkout.recogerAviso', 'Checkout', 'Tiempo de preparación y aviso (checkout y detalle del pedido).', '{tiempoPreparacion}. Te avisamos en la app y por correo cuando puedas pasar por él.'),
  d('checkout.opcionLineaTitulo', 'Checkout', 'Forma de pago en línea: título.', 'Pagar en línea', { max: 60 }),
  d('checkout.opcionLineaTexto', 'Checkout', 'Forma de pago en línea: explicación.', 'Con tarjeta en la página segura de Mercado Pago.'),
  d('checkout.opcionSalonTitulo', 'Checkout', 'Forma de pago en el salón: título.', 'Pagar al recoger en el salón', { max: 60 }),
  d('checkout.opcionSalonTexto', 'Checkout', 'Forma de pago en el salón: explicación.', 'Te apartamos el pedido y lo pagas en el mostrador cuando pases por él.'),
  d('checkout.ambasRecoges', 'Checkout', 'Debajo de las formas de pago cuando hay dos.', 'En los dos casos recoges tu pedido en el salón.'),
  d('checkout.soloRecoges', 'Checkout', 'Debajo de las formas de pago cuando hay una.', 'Recoges tu pedido en el salón.'),
  d('checkout.avisoSalon', 'Checkout', 'Aviso del pago al recoger.', 'Tu pedido queda apartado. Pagas {total} en el mostrador cuando pases por él{metodosSalon}.', { contexto: ['total', 'metodosSalon'] }),
  d('checkout.avisoLinea', 'Checkout', 'Aviso del pago en línea (aviso de privacidad corto sobre la tarjeta).', 'Al confirmar te llevamos a Mercado Pago para pagar {total}. Tu tarjeta la escribes allá: este sitio no la ve ni la guarda. Tienes {plazoPagoLineaHoras} horas para completar el pago.', { contexto: ['total'] }),
  boton('checkout.botonLinea', 'Checkout', 'Botón final con pago en línea.', 'Ir a pagar con Mercado Pago'),
  boton('checkout.botonSalon', 'Checkout', 'Botón final con pago al recoger.', 'Apartar mi pedido'),
  d('tienda.confirmacionTitulo', 'Checkout', 'Confirmación de compra: título.', '¡Gracias por tu compra!', { max: 80 }),
  d('tienda.confirmacionApartado', 'Checkout', 'Confirmación de un pedido apartado para pagar al recoger.', 'Te apartamos tu pedido. Te avisamos en la app y por correo cuando esté listo para recogerlo y pagarlo en el salón.'),
  d('tienda.confirmacionRegistrado', 'Checkout', 'Confirmación de un pedido en línea (antes de que se acredite el pago).', 'Tu pedido quedó registrado. Te avisamos en la app y por correo cuando esté listo para recoger en el salón.'),
  d('tienda.pagoRecibidoTexto', 'Checkout', 'Regreso de Mercado Pago con el pago acreditado.', 'Tu pedido quedó pagado. Te avisamos en la app y por correo cuando esté listo para recoger en el salón.'),
  d('tienda.pagoEnProcesoTexto', 'Checkout', 'Regreso de Mercado Pago con el pago todavía sin acreditar.', 'Mercado Pago aún no lo confirma. Te avisamos en la app y por correo en cuanto se acredite.'),

  // --- Mis pedidos ---
  d('pedidos.lista.vacia', 'Mis pedidos', 'Lista de pedidos vacía.', 'No tienes pedidos realizados', { max: 80 }),
  d('pedidos.lista.sinResultados', 'Mis pedidos', 'Búsqueda sin resultados.', 'Ningún pedido coincide con la búsqueda', { max: 80 }),
  d('pedidos.estado.apartado', 'Mis pedidos', 'Apartado pendiente de pago.', 'Tu pedido está apartado. Lo preparamos y te avisamos cuando puedas pasar a pagarlo y recogerlo.'),
  d('pedidos.estado.faltaPago', 'Mis pedidos', 'Pago en línea pendiente (el plazo es el guardado en el pedido).', 'Falta completar tu pago en Mercado Pago. Tienes {plazoPago} horas desde que hiciste el pedido.', { contexto: ['plazoPago'] }),
  d('pedidos.estado.confirmandoPago', 'Mis pedidos', 'Pago por confirmar.', 'Estamos confirmando tu pago. Después lo preparamos y te avisamos.'),
  d('pedidos.estado.pagado', 'Mis pedidos', 'Pedido pagado.', 'Pago recibido. Lo preparamos y te avisamos cuando esté listo para recoger.'),
  d('pedidos.estado.preparando', 'Mis pedidos', 'Pedido en preparación.', 'Estamos preparando tu pedido. Te avisamos en la app y por correo cuando esté listo.'),
  d('pedidos.estado.listoPagar', 'Mis pedidos', 'Apartado listo para pagar y recoger.', 'Tu pedido está listo. Pasa por él al salón y págalo en el mostrador{metodosSalon}.', { contexto: ['metodosSalon'] }),
  d('pedidos.estado.listo', 'Mis pedidos', 'Pedido pagado listo para recoger.', 'Tu pedido está listo. Pasa por él al salón.'),
  d('pedidos.estado.entregado', 'Mis pedidos', 'Pedido entregado.', 'Recogiste tu pedido en el salón.'),
  d('pedidos.cancelarORevocar', 'Mis pedidos', 'Diferencia entre cancelar y revocar (el plazo es el guardado en el pedido).', 'Las dos te devuelven lo que pagaste. «Cancelar pedido» solo se puede antes de que empecemos a prepararlo; «Revocar compra» es tu derecho por ley durante {diasRevocacion} días hábiles y sigue disponible aunque ya lo hayamos preparado o lo hayas recogido.', { max: 400, contexto: ['diasRevocacion'] }),
  d('pedidos.revocacion.pendiente', 'Mis pedidos', 'Revocación por recibir.', 'Revocaste tu compra. Entrega tu pedido en el salón: al recibirlo te reembolsamos{monto} por el mismo medio con el que pagaste.', { contexto: ['monto'] }),
  d('pedidos.revocacion.aprobada', 'Mis pedidos', 'Revocación aprobada.', 'Revocaste tu compra: recibimos tu pedido y te reembolsamos{monto} por el mismo medio con el que pagaste.', { contexto: ['monto'] }),
  d('pedidos.revocacion.rechazada', 'Mis pedidos', 'Revocación rechazada.', 'Revocaste tu compra, pero el salón rechazó la revocación. Si tienes dudas, comunícate con el salón.'),
  d('pedidos.sinValoraciones', 'Mis pedidos', 'Detalle del pedido sin reseñas.', 'Aún no hay reseñas registradas para productos de este pedido.'),
  d('pedidos.sinDevoluciones', 'Mis pedidos', 'Detalle del pedido sin devoluciones (sigue el enlace a devoluciones).', 'No hay solicitudes para este pedido.'),

  // --- Garantías ---
  d('garantias.subtitulo', 'Garantías', 'Subtítulo de Garantías y soporte.', 'Si algo de tu servicio no salió como esperabas, tienes {diasGarantia} días para reportarlo. También puedes escribirnos cualquier duda o sugerencia.'),
  d('garantias.vacia', 'Garantías', 'Sin casos registrados.', 'Aún no tienes casos registrados.', { max: 80 }),
  d('garantias.formularioTexto', 'Garantías', 'Texto arriba del formulario.', 'Cuéntanos qué pasó y te responderemos en tu cuenta.'),
  d('garantias.toastRegistrado', 'Garantías', 'Aviso al registrar un caso.', 'Recibimos tu caso. Te responderemos en tu cuenta.', { max: 120 }),

  // --- Devoluciones ---
  d('devoluciones.subtitulo', 'Devoluciones', 'Subtítulo de la pantalla.', 'Solicitudes registradas en el sistema según tus pedidos', { max: 120 }),
  d('devoluciones.vacia', 'Devoluciones', 'Sin solicitudes.', 'No hay devoluciones registradas.', { max: 80 }),
  d('devoluciones.requisito', 'Devoluciones', 'Cuando no hay pedidos que se puedan devolver (sigue el enlace a pedidos).', 'Necesitas un pedido entregado, o uno cancelado que ya hayas pagado.'),
  d('devoluciones.toastRegistrada', 'Devoluciones', 'Aviso al registrar una solicitud.', 'Solicitud registrada.', { max: 120 }),

  // --- Correos (asunto y cuerpo; el diseño se queda en el código) ---
  cuerpo('correos.pieAutomatico', 'Pie de los correos automáticos.', 'Este es un correo automático, por favor no respondas.'),
  asunto('correos.activacion.asunto', 'Código de activación de la cuenta.', 'Código de activación - {nombreSalon}'),
  cuerpo('correos.activacion.titulo', 'Código de activación: título.', 'Bienvenido a {nombreSalon}'),
  cuerpo('correos.activacion.cuerpo', 'Código de activación: antes del código.', 'Tu código de verificación es:'),
  cuerpo('correos.activacion.nota', 'Código de activación: después del código (un párrafo por línea en blanco).', 'Ingresa este código en la aplicación para activar tu cuenta.\n\nEste código expira en 2 minutos.\n\nSi no solicitaste este código, ignora este mensaje.'),
  asunto('correos.recuperar.asunto', 'Recuperar contraseña.', 'Recuperar Contraseña - {nombreSalon}'),
  cuerpo('correos.recuperar.titulo', 'Recuperar contraseña: título.', 'Solicitud de Recuperación de Contraseña'),
  cuerpo('correos.recuperar.cuerpo', 'Recuperar contraseña: explicación.', 'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Si fuiste tú, haz clic en el botón de abajo para crear una nueva contraseña.'),
  cuerpo('correos.recuperar.boton', 'Recuperar contraseña: botón.', 'Restablecer Contraseña'),
  cuerpo('correos.recuperar.importante', 'Recuperar contraseña: lista "Importante" (una línea por punto).', 'Este enlace expira en {minutos} minutos\nSolo puede ser usado una vez\nSi no solicitaste este cambio, ignora este mensaje', ['minutos']),
  cuerpo('correos.recuperar.enlaceAlterno', 'Recuperar contraseña: antes del enlace escrito.', 'Si el botón no funciona, copia y pega este enlace en tu navegador:'),
  asunto('correos.codigoPassword.asunto', 'Código para cambiar la contraseña.', 'Código para cambiar tu contraseña - {nombreSalon}'),
  cuerpo('correos.codigoPassword.titulo', 'Código para cambiar la contraseña: título.', 'Cambio de contraseña'),
  cuerpo('correos.codigoPassword.cuerpo', 'Código para cambiar la contraseña: antes del código.', 'Para cambiar la contraseña de tu cuenta de {nombreSalon}, ingresa este código:'),
  cuerpo('correos.codigoPassword.nota', 'Código para cambiar la contraseña: después del código.', 'Este código vence en {minutos} minutos y solo sirve una vez.\n\nSi no fuiste tú, ignora este correo y cambia tu contraseña.', ['minutos']),
  asunto('correos.codigoCorreo.asunto', 'Código para cambiar el correo (al correo nuevo).', 'Código para cambiar tu correo - {nombreSalon}'),
  cuerpo('correos.codigoCorreo.titulo', 'Código para cambiar el correo: título.', 'Cambio de correo'),
  cuerpo('correos.codigoCorreo.cuerpo', 'Código para cambiar el correo: antes del código.', 'Para usar este correo en tu cuenta de {nombreSalon}, ingresa este código:'),
  cuerpo('correos.codigoCorreo.nota', 'Código para cambiar el correo: después del código.', 'Este código vence en {minutos} minutos y solo sirve una vez.\n\nSi no fuiste tú, ignora este correo: tu cuenta no cambia.', ['minutos']),
  asunto('correos.correoActual.asunto', 'Confirmar el cambio de correo (al correo actual).', 'Confirma el cambio de tu correo - {nombreSalon}'),
  cuerpo('correos.correoActual.titulo', 'Confirmar el cambio de correo: título.', 'Confirma el cambio de tu correo'),
  cuerpo('correos.correoActual.cuerpo', 'Confirmar el cambio de correo: antes del código.', 'Pidieron cambiar el correo de tu cuenta de {nombreSalon} a {correoNuevo}. Si fuiste tú, ingresa este código junto con el que llegó a tu nuevo correo:', ['correoNuevo']),
  cuerpo('correos.correoActual.nota', 'Confirmar el cambio de correo: después del código.', 'Este código vence en {minutos} minutos y solo sirve una vez.\n\nSi no fuiste tú, no compartas este código con nadie: sin él tu correo no cambia. Te recomendamos cerrar sesión en los dispositivos que no reconozcas.', ['minutos']),
  asunto('correos.passwordCambiada.asunto', 'Aviso de contraseña cambiada.', 'Tu contraseña cambió - {nombreSalon}'),
  cuerpo('correos.passwordCambiada.titulo', 'Aviso de contraseña cambiada: título.', 'Tu contraseña cambió'),
  cuerpo('correos.passwordCambiada.cuerpo', 'Aviso de contraseña cambiada: explicación.', 'La contraseña de tu cuenta de {nombreSalon} se cambió el {fechaHora} (hora del centro de México).\n\nPor seguridad cerramos todas tus sesiones: inicia sesión de nuevo con tu nueva contraseña.', ['fechaHora']),
  cuerpo('correos.passwordCambiada.nota', 'Aviso de contraseña cambiada: qué hacer si no fue ella ({enlaceRecuperar} es el enlace).', 'Si no fuiste tú, recupera tu cuenta ahora desde {enlaceRecuperar} y elige una contraseña nueva.', ['enlaceRecuperar']),
  cuerpo('correos.passwordCambiada.textoEnlace', 'Aviso de contraseña cambiada: texto del enlace para recuperar.', '¿Olvidaste tu contraseña?'),
  asunto('correos.correoCambiado.asunto', 'Aviso de correo cambiado (al correo anterior).', 'Tu correo cambió - {nombreSalon}'),
  cuerpo('correos.correoCambiado.titulo', 'Aviso de correo cambiado: título.', 'Tu correo cambió'),
  cuerpo('correos.correoCambiado.cuerpo', 'Aviso de correo cambiado: explicación.', 'El correo de tu cuenta de {nombreSalon} se cambió el {fechaHora} (hora del centro de México). Desde ahora, este correo ya no sirve para entrar ni para recuperar tu cuenta.', ['fechaHora']),
  cuerpo('correos.correoCambiado.nota', 'Aviso de correo cambiado: qué hacer si no fue ella.', 'Si no fuiste tú, comunícate con el salón lo antes posible para recuperar tu cuenta.'),
  asunto('correos.preguntaCambiada.asunto', 'Aviso de pregunta de seguridad cambiada.', 'Tu pregunta de seguridad cambió - {nombreSalon}'),
  cuerpo('correos.preguntaCambiada.titulo', 'Aviso de pregunta de seguridad cambiada: título.', 'Tu pregunta de seguridad cambió'),
  cuerpo('correos.preguntaCambiada.cuerpo', 'Aviso de pregunta de seguridad cambiada: explicación.', 'La pregunta de seguridad de tu cuenta de {nombreSalon} se cambió el {fechaHora} (hora del centro de México).', ['fechaHora']),
  cuerpo('correos.preguntaCambiada.nota', 'Aviso de pregunta de seguridad cambiada: qué hacer si no fue ella.', 'Si no fuiste tú, cambia tu contraseña desde tu perfil y comunícate con el salón lo antes posible.'),
  asunto('correos.arcoRespuesta.asunto', 'Respuesta a una solicitud ARCO.', 'Respuesta a tu solicitud {folio} - {nombreSalon}', ['folio']),
  cuerpo('correos.arcoRespuesta.titulo', 'Respuesta ARCO: título.', 'Respuesta a tu solicitud de derechos ARCO'),
  cuerpo('correos.arcoRespuesta.nota', 'Respuesta ARCO: dónde ver sus solicitudes.', 'También puedes ver tus solicitudes en tu perfil, en la sección de privacidad.'),
  asunto('correos.arcoCancelacion.asunto', 'Cancelación de la cuenta por ARCO.', 'Cancelamos tu cuenta - {nombreSalon}'),
  cuerpo('correos.arcoCancelacion.titulo', 'Cancelación de la cuenta: título.', 'Cancelamos tu cuenta'),
  cuerpo(
    'correos.arcoCancelacion.cuerpo',
    'Cancelación de la cuenta: qué se borró y qué se conserva por ley (un párrafo por línea en blanco).',
    'Atendimos tu solicitud de cancelación con folio {folio} el {fecha} (hora del centro de México).\n\nAnonimizamos tus datos personales: tu nombre, correo, teléfono, direcciones, datos de salud y de tu cabello, tarjetas guardadas y notas ya no están en tu cuenta, y ya no puedes iniciar sesión con ella.\n\nPor obligación legal conservamos tus pedidos, pagos, facturas y ventas durante 5 años (artículo 30 del Código Fiscal de la Federación), y también tus citas, quejas y valoraciones sin tu nombre, la constancia de tus consentimientos y tus solicitudes ARCO.',
    ['folio', 'fecha'],
  ),
  cuerpo('correos.arcoCancelacion.nota', 'Cancelación de la cuenta: qué hacer si no la pidió.', 'Si no pediste esta cancelación, comunícate con el salón lo antes posible.'),

  // --- Avisos internos (campana, aviso en pantalla y, en algunos, correo) ---
  titulo('avisos.citaCreada.titulo', 'Clienta: cita agendada.', 'Cita agendada'),
  mensaje('avisos.citaCreada.mensaje', 'Clienta: cita agendada.', 'Tu cita de {servicio} quedó agendada para el {fecha}', CTX_CITA),
  titulo('avisos.citaAsignada.titulo', 'Especialista: cita asignada.', 'Nueva cita asignada'),
  mensaje('avisos.citaAsignada.mensaje', 'Especialista: cita asignada.', 'Se te asignó una cita de {servicio} para el {fecha}', CTX_CITA),
  titulo('avisos.citaRecordatorio.titulo', 'Clienta: recordatorio de cita (también por correo).', 'Recordatorio de cita'),
  mensaje('avisos.citaRecordatorio.mensaje', 'Clienta: recordatorio de cita (también por correo).', 'Tu cita de {servicio} es el {fecha}', CTX_CITA),
  titulo('avisos.citaCancelada.titulo', 'Clienta y especialista: cita cancelada.', 'Cita cancelada'),
  mensaje('avisos.citaCancelada.mensajeClienta', 'Clienta: cita cancelada.', 'Tu cita fue cancelada. Motivo: {motivo}', ['motivo', ...CTX_CITA]),
  mensaje('avisos.citaCancelada.mensajeEspecialista', 'Especialista: cita cancelada.', 'La cita que tenías asignada fue cancelada. Motivo: {motivo}', ['motivo']),
  titulo('avisos.citaReprogramada.titulo', 'Clienta y especialista: cita reprogramada.', 'Cita reprogramada'),
  mensaje('avisos.citaReprogramada.mensajeClienta', 'Clienta: cita reprogramada.', 'Tu cita de {servicio} fue reprogramada para el {fecha}', CTX_CITA),
  mensaje('avisos.citaReprogramada.mensajeEspecialista', 'Especialista: cita reprogramada.', 'La cita de {servicio} que tenías asignada fue reprogramada para el {fecha}', CTX_CITA),
  titulo('avisos.citaNueva.titulo', 'Personal: cita nueva.', 'Cita nueva'),
  mensaje('avisos.citaNueva.mensaje', 'Personal: cita nueva.', 'Nueva cita de {servicio} para el {fecha}', CTX_CITA),
  titulo('avisos.anticipoPagadoPersonal.titulo', 'Caja: anticipo pagado.', 'Anticipo pagado'),
  mensaje('avisos.anticipoPagadoPersonal.mensaje', 'Caja: anticipo pagado.', 'Se recibió el anticipo de la cita #{cita}: quedó confirmada.', ['cita']),
  titulo('avisos.anticipoRecibido.titulo', 'Clienta: anticipo recibido.', 'Anticipo recibido'),
  mensaje('avisos.anticipoRecibido.mensaje', 'Clienta: anticipo recibido.', 'Recibimos tu anticipo: tu cita quedó confirmada.', ['cita']),
  titulo('avisos.anticipoRevision.titulo', 'Caja: anticipo por revisar.', 'Anticipo por revisar'),
  mensaje('avisos.anticipoRevision.canceladaPorClienta', 'Caja: la clienta canceló con anticipo pagado.', 'La clienta canceló la cita #{cita} con anticipo pagado: decidir si se reembolsa o se retiene', ['cita']),
  mensaje('avisos.anticipoRevision.montoDistinto', 'Caja: anticipo con monto distinto.', 'Anticipo con un monto distinto en la cita #{cita}: revisar devolución', ['cita']),
  mensaje('avisos.anticipoRevision.citaLiberada', 'Caja: anticipo de una cita ya liberada.', 'Anticipo pagado de una cita que ya se liberó o canceló (#{cita}): revisar devolución', ['cita']),
  titulo('avisos.anticipoPorDevolver.titulo', 'Caja: anticipo por devolver.', 'Anticipo por devolver'),
  mensaje('avisos.anticipoPorDevolver.salon', 'Caja: devolver el anticipo pagado en el salón.', 'La clienta canceló a tiempo la cita #{cita}: devuélvele el anticipo que pagó en el salón.', ['cita']),
  mensaje('avisos.anticipoPorDevolver.fallo', 'Caja: falló el reembolso automático del anticipo.', 'La clienta canceló a tiempo la cita #{cita} y el reembolso automático del anticipo no salió: reembólsalo a mano.', ['cita']),
  titulo('avisos.venta.titulo', 'Clienta: ticket de una compra en el salón.', 'Tu ticket de compra'),
  mensaje('avisos.venta.mensaje', 'Clienta: ticket de una compra en el salón.', 'Folio {folio} · Total {monto} · {fecha}', ['folio', 'monto', 'fecha']),
  titulo('avisos.pedidoRecibido.titulo', 'Clienta: pedido recibido.', 'Pedido recibido'),
  mensaje('avisos.pedidoRecibido.mensaje', 'Clienta: pedido recibido.', 'Recibimos tu pedido #{pedido}, pendiente de pago', CTX_PEDIDO),
  titulo('avisos.pedidoConfirmado.titulo', 'Clienta: pedido pagado.', 'Pedido confirmado'),
  mensaje('avisos.pedidoConfirmado.mensaje', 'Clienta: pedido pagado.', 'Tu pedido #{pedido} fue confirmado: pago recibido', CTX_PEDIDO),
  titulo('avisos.pedidoListo.titulo', 'Clienta: pedido listo para recoger (también por correo).', 'Tu pedido está listo para recoger'),
  mensaje('avisos.pedidoListo.mensaje', 'Clienta: pedido listo para recoger (también por correo).', 'Tu pedido #{pedido} está listo para recoger en el salón', CTX_PEDIDO),
  titulo('avisos.pedidoEntregado.titulo', 'Clienta: pedido entregado.', 'Pedido entregado en el salón'),
  mensaje('avisos.pedidoEntregado.mensaje', 'Clienta: pedido entregado.', 'Tu pedido #{pedido} fue entregado en el salón', CTX_PEDIDO),
  titulo('avisos.pedidoCancelado.titulo', 'Clienta: pedido cancelado (también los vencidos).', 'Pedido cancelado'),
  mensaje('avisos.pedidoCancelado.mensaje', 'Clienta: pedido cancelado.', 'Tu pedido #{pedido} fue cancelado', CTX_PEDIDO),
  mensaje('avisos.pedidoVencido.sinPreparar', 'Clienta: apartado cancelado porque no se preparó (también por correo; el plazo es el del pedido).', 'Tu apartado #{pedido} se canceló porque no se preparó en {diasPrepararApartado} días. Puedes volver a pedirlo en la tienda.', CTX_PEDIDO),
  mensaje('avisos.pedidoVencido.noRecogido', 'Clienta: apartado cancelado porque no se recogió (también por correo; el plazo es el del pedido).', 'Cancelamos tu apartado #{pedido} porque no se recogió en {diasCancelarNoRecogido} días.', CTX_PEDIDO),
  mensaje('avisos.pedidoVencido.pagoVencido', 'Clienta: pedido cancelado porque no se pagó en línea (también por correo; el plazo es el del pedido).', 'Tu pedido #{pedido} se canceló porque el pago no se completó en {plazoPagoLineaHoras} horas.', CTX_PEDIDO),
  titulo('avisos.recordatorioRecoger.titulo', 'Clienta: recordatorio para recoger (también por correo).', 'Tu pedido te espera en el salón'),
  mensaje('avisos.recordatorioRecoger.mensaje', 'Clienta: recordatorio para recoger (el plazo es el del pedido).', 'Recuerda pasar por tu pedido #{pedido}. Si no lo recoges en {diasRestantesRecoger} días más, se cancelará.', CTX_PEDIDO),
  titulo('avisos.pedidoNuevo.titulo', 'Personal: pedido nuevo.', 'Pedido nuevo'),
  mensaje('avisos.pedidoNuevo.pagado', 'Personal: pedido pagado por preparar.', 'El pedido #{pedido} ya está pagado: prepáralo para recoger en el salón.', CTX_PEDIDO),
  mensaje('avisos.pedidoNuevo.apartado', 'Personal: apartado nuevo.', 'Nuevo apartado #{pedido}: se paga al recogerlo en el salón.', CTX_PEDIDO),
  titulo('avisos.pagoRevision.titulo', 'Reembolsos: pago por revisar.', 'Pago por revisar'),
  mensaje('avisos.pagoRevision.montoDistinto', 'Reembolsos: pago con monto distinto.', 'Pago con un monto distinto al del pedido #{pedido}: revisar devolución', CTX_PEDIDO),
  mensaje('avisos.pagoRevision.pedidoCancelado', 'Reembolsos: pago de un pedido cancelado.', 'Pago recibido de un pedido cancelado #{pedido}: revisar devolución', CTX_PEDIDO),
  mensaje('avisos.pagoRevision.yaPagado', 'Reembolsos: pago de un pedido ya pagado.', 'Pago recibido de un pedido que ya estaba pagado #{pedido}: revisar devolución', CTX_PEDIDO),
  titulo('avisos.canceladoPagado.tituloReembolsado', 'Caja: la clienta canceló un pedido pagado (reembolso hecho).', 'Pedido pagado cancelado'),
  titulo('avisos.canceladoPagado.tituloRevision', 'Caja: la clienta canceló un pedido pagado (reembolso pendiente).', 'Reembolso por revisar'),
  mensaje('avisos.canceladoPagado.reembolsado', 'Caja: reembolso hecho en Mercado Pago.', '{clienta} canceló el pedido #{pedido} ya pagado ({monto}): el reembolso en Mercado Pago ya salió', ['clienta', 'pedido', 'monto']),
  mensaje('avisos.canceladoPagado.revision', 'Caja: reembolso por hacer a mano.', '{clienta} canceló el pedido #{pedido} ya pagado ({monto}): el reembolso quedó en revisión, reembolsar a mano', ['clienta', 'pedido', 'monto']),
  titulo('avisos.revocacion.titulo', 'Devoluciones: revocación por recibir.', 'Revocación por recibir'),
  mensaje('avisos.revocacion.mensaje', 'Devoluciones: revocación por recibir.', 'La clienta revocó la compra del pedido #{pedido}: recibe el producto en el salón y reembolsa.', ['pedido', 'monto']),
  titulo('avisos.reembolso.tituloHecho', 'Clienta: reembolso realizado.', 'Reembolso realizado'),
  titulo('avisos.reembolso.tituloProceso', 'Clienta: reembolso en proceso.', 'Reembolso en proceso'),
  mensaje('avisos.reembolso.cancelacionHecho', 'Clienta: reembolso de su pedido cancelado.', 'Te reembolsamos {monto} del pedido #{pedido}. Puede tardar unos días en verse en tu cuenta.', ['monto', 'pedido']),
  mensaje('avisos.reembolso.cancelacionProceso', 'Clienta: reembolso de su pedido cancelado en proceso.', 'Estamos procesando el reembolso de {monto} del pedido #{pedido}.', ['monto', 'pedido']),
  mensaje('avisos.reembolso.pedido', 'Clienta: reembolso de un pedido hecho por el personal.', 'Te reembolsamos {monto} del pedido #{pedido}.', ['monto', 'pedido']),
  mensaje('avisos.reembolso.anticipo', 'Clienta: reembolso del anticipo hecho por el personal.', 'Te reembolsamos {monto} del anticipo de tu cita #{cita}.', ['monto', 'cita']),
  titulo('avisos.arcoNueva.titulo', 'Admin: solicitud ARCO nueva.', 'Solicitud ARCO nueva'),
  mensaje('avisos.arcoNueva.mensaje', 'Admin: solicitud ARCO nueva.', 'Nueva solicitud de {tipoArco} con folio {folio}.', ['tipoArco', 'folio']),
  titulo('avisos.arcoRespuesta.titulo', 'Titular: respuesta a su solicitud ARCO.', 'Respuesta a tu solicitud ARCO'),
  mensaje('avisos.arcoRespuesta.mensaje', 'Titular: respuesta a su solicitud ARCO (sin el texto de la respuesta).', 'Tu solicitud con folio {folio} {estadoArco}.', ['folio', 'estadoArco']),
] as DefinicionTexto[]);

export const DEFINICION_POR_CLAVE: ReadonlyMap<string, DefinicionTexto> = new Map(CATALOGO_TEXTOS.map((t) => [t.clave, t]));

/** Variables que puede usar una clave: todas las de reglas más las de su contexto. */
export function variablesPermitidas(def: DefinicionTexto): string[] {
  return [...VARIABLES_REGLAS, ...def.contexto];
}
