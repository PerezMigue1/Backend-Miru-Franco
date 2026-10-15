import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoCita, EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { sumarDiasHabiles } from '../common/utils/dias-habiles.util';
import { sanitizeInput } from '../common/utils/security.util';
import { CAMPOS_SALUD_EN_NULL } from '../consentimientos/consentimientos.constants';
import { ContextoPeticion, filaConsentimiento, serializarConsentimiento } from '../consentimientos/documentos-legales';
import {
  ActualizarSolicitudArcoDto,
  ConsentimientoRevocable,
  CrearSolicitudArcoDto,
  EstadoArco,
  OposicionArcoDto,
} from './dto/arco.dto';
import { TX_HOLGADA } from '../pos/salidas-caja';

/** Plazos de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (días hábiles). */
export const DIAS_HABILES_RESPUESTA = 20;
export const DIAS_HABILES_EFECTIVIDAD = 15;

/** Lo que la titular ve de sus solicitudes (sin quién la atendió del personal). */
const SELECT_SOLICITUD_PROPIA = {
  id: true,
  folio: true,
  tipo: true,
  descripcion: true,
  estado: true,
  creadaEn: true,
  venceRespuesta: true,
  respuesta: true,
  respondidaEn: true,
  venceEfectividad: true,
  atendidaEn: true,
} as const;

/** Datos personales del perfil para "mis datos": todo lo de la titular, incluidos sus datos de salud; nada secreto. */
const SELECT_MIS_DATOS = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  fechaNacimiento: true,
  foto: true,
  googleId: true,
  rol: true,
  aceptaAvisoPrivacidad: true,
  recibePromociones: true,
  confirmado: true,
  activo: true,
  creadoEn: true,
  actualizadoEn: true,
  ultimaActividad: true,
  tipoCabello: true,
  colorNatural: true,
  colorActual: true,
  productosUsados: true,
  alergias: true,
  tratamientosQuimicos: true,
  tratamientos: true,
} as const;

/**
 * Tarjetas guardadas: solo marca, últimos 4 dígitos y vencimiento, nunca datos completos (ni idExterno, el
 * identificador con el que la pasarela cobra).
 */
const SELECT_TARJETA_MIS_DATOS = {
  marca: true,
  ultimos4: true,
  expMes: true,
  expAnio: true,
} as const;

/** Observaciones que el personal registró sobre ella (CRM): el texto y la fecha, sin quién del personal la escribió. */
const SELECT_OBSERVACION_MIS_DATOS = {
  id: true,
  texto: true,
  creadoEn: true,
} as const;

/** Ventas en el salón (POS) donde ella es la clienta; sin datos del personal (cajero) ni del corte de caja. */
const SELECT_VENTA_MIS_DATOS = {
  id: true,
  folio: true,
  estado: true,
  metodoPago: true,
  subtotal: true,
  descuento: true,
  anticipo: true,
  total: true,
  montoEfectivo: true,
  montoTarjeta: true,
  montoTransferencia: true,
  notas: true,
  motivoCancelacion: true,
  creadoEn: true,
  items: {
    select: {
      id: true,
      cantidad: true,
      precioUnitario: true,
      subtotal: true,
      citaId: true,
      servicio: { select: { id: true, nombre: true } },
      presentacion: { select: { id: true, tamanio: true, producto: { select: { id: true, nombre: true } } } },
    },
  },
} as const;

/** Facturas y notas de sus pedidos (datos fiscales que ella dio); sin quién del personal la emitió. */
const SELECT_FACTURA_MIS_DATOS = {
  id: true,
  tipo: true,
  uuidFiscal: true,
  folio: true,
  serie: true,
  rfc: true,
  razonSocial: true,
  xmlUrl: true,
  pdfUrl: true,
  estado: true,
  clienteNombre: true,
  concepto: true,
  monto: true,
  creadoEn: true,
  pedidoId: true,
} as const;

/** Seguimientos posteriores al servicio (notas del personal sobre ella), sin quién del personal los registró. */
const SELECT_SEGUIMIENTO_MIS_DATOS = {
  id: true,
  notas: true,
  fechaContacto: true,
  satisfaccion: true,
  requiereAccion: true,
  citaId: true,
  creadoEn: true,
} as const;

/** Devoluciones de sus pedidos y cómo se resolvieron; sin quién del personal las resolvió. */
const SELECT_DEVOLUCION_MIS_DATOS = {
  id: true,
  pedidoId: true,
  pedidoItemId: true,
  tipo: true,
  causa: true,
  motivo: true,
  estado: true,
  monto: true,
  metodoReembolso: true,
  origen: true,
  notaResolucion: true,
  resueltoEn: true,
  creadoEn: true,
} as const;

/**
 * Pagos de sus pedidos y anticipos de sus citas. Sin el payload crudo ni la referencia de la pasarela, sin el detalle
 * técnico del error y sin quién del personal cobró ni en qué corte de caja.
 */
const SELECT_PAGO_MIS_DATOS = {
  id: true,
  pedidoId: true,
  citaId: true,
  intentoNumero: true,
  monto: true,
  moneda: true,
  metodo: true,
  proveedor: true,
  estado: true,
  pagadoEn: true,
  retenidoEn: true,
  reembolsadoEn: true,
  creadoEn: true,
} as const;

/** Notificaciones que le mandamos; sin metadata (datos internos del envío que pueden llevar enlaces de un solo uso). */
const SELECT_NOTIFICACION_MIS_DATOS = {
  id: true,
  tipo: true,
  titulo: true,
  mensaje: true,
  leida: true,
  leidaEn: true,
  prioridad: true,
  entidadTipo: true,
  entidadId: true,
  urlAccion: true,
  programadaPara: true,
  creadoEn: true,
} as const;

const SELECT_PREFERENCIA_MIS_DATOS = {
  tipo: true,
  canal: true,
  activo: true,
  creadoEn: true,
} as const;

/** Campos personales de las direcciones que se borran al cancelar la cuenta (las columnas obligatorias quedan con un texto neutro). */
const DIRECCION_ANONIMA = {
  calle: 'Dirección eliminada',
  numeroInterior: null,
  indicaciones: null,
  contactoNombreApellido: 'Cuenta cancelada',
  contactoTelefono: '',
} as const;

const NOMBRE_ANONIMO = 'Cuenta cancelada';
/** Dominio reservado de los correos de cuentas anonimizadas: no existe, no se les manda correo. */
const DOMINIO_ANONIMO = '@anonimo.invalid';

const RESPUESTA_CANCELACION =
  'Cancelamos tu cuenta y anonimizamos tus datos personales. Por obligación legal conservamos tus pedidos, pagos, facturas y ' +
  'ventas durante 5 años (art. 30 del Código Fiscal de la Federación), y también tus citas, quejas y valoraciones sin tu ' +
  'nombre, la constancia de tus consentimientos y tus solicitudes ARCO.';

/** Revocaciones y oposiciones atendidas desde la bandeja del admin: así quedan en la evidencia. */
const FORMULARIO_BANDEJA = 'arco-bandeja';
const RUTA_BANDEJA = '/admin/solicitudes-arco';

const ESTADOS_CERRADOS: ReadonlyArray<string> = ['atendida', 'rechazada'];

/**
 * Transiciones que el admin puede hacer. Una respondida no regresa a en_proceso; volver a responderla solo cambia el
 * texto (no reinicia el plazo de efectividad). atendida y rechazada son finales.
 */
const TRANSICIONES: Readonly<Record<string, ReadonlyArray<string>>> = {
  recibida: ['en_proceso', 'respondida', 'atendida', 'rechazada'],
  en_proceso: ['respondida', 'atendida', 'rechazada'],
  respondida: ['respondida', 'atendida', 'rechazada'],
};

const ETIQUETA_ESTADO: Readonly<Record<string, string>> = {
  recibida: 'recibida',
  en_proceso: 'en proceso',
  respondida: 'respondida',
  atendida: 'atendida',
  rechazada: 'rechazada',
};

/** Estados con los que se avisa a la titular por correo (llevan respuesta). */
const ESTADOS_CON_AVISO: ReadonlyArray<string> = ['respondida', 'atendida', 'rechazada'];

/**
 * Operaciones que impiden anonimizar: pedidos sin terminar, citas activas que aún no terminan y devoluciones pendientes.
 * Un borrador no tiene pago ni stock apartado, así que no cuenta; un apartado (pendiente_pago) sí.
 */
const ESTADOS_PEDIDO_TERMINADO: EstadoPedido[] = ['entregado', 'cancelado', 'borrador'];
const ESTADOS_CITA_ACTIVA: EstadoCita[] = ['pendiente', 'confirmada', 'reprogramada'];

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 100;

function aEntero(valor: string | undefined, porDefecto: number, minimo: number, maximo: number): number {
  const n = Number.parseInt(valor ?? '', 10);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

function estaVencida(s: { estado: string; venceRespuesta: Date; venceEfectividad?: Date | null }, ahora: Date): boolean {
  if (s.estado === 'recibida' || s.estado === 'en_proceso') return s.venceRespuesta < ahora;
  if (s.estado === 'respondida') return !!s.venceEfectividad && s.venceEfectividad < ahora;
  return false;
}

const esCorreoAnonimo = (correo: string) => correo.toLowerCase().endsWith(DOMINIO_ANONIMO);

/**
 * "Tiene 1 pedido y 2 citas en curso: termínalos o cancélalos antes de anonimizar." El pronombre concuerda con lo que
 * hay (masculino si hay algún pedido, plural si son varias cosas). null si no hay nada en curso.
 */
export function mensajeOperacionesEnCurso(n: { pedidos: number; citas: number; devoluciones: number }): string | null {
  const partes: string[] = [];
  if (n.pedidos > 0) partes.push(`${n.pedidos} ${n.pedidos === 1 ? 'pedido' : 'pedidos'}`);
  if (n.citas > 0) partes.push(`${n.citas} ${n.citas === 1 ? 'cita' : 'citas'}`);
  if (n.devoluciones > 0) partes.push(`${n.devoluciones} ${n.devoluciones === 1 ? 'devolución' : 'devoluciones'}`);
  if (partes.length === 0) return null;
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  const total = n.pedidos + n.citas + n.devoluciones;
  const masculino = n.pedidos > 0;
  const pronombre = total === 1 ? (masculino ? 'lo' : 'la') : masculino ? 'los' : 'las';
  return `Tiene ${lista} en curso: termína${pronombre} o cancéla${pronombre} antes de anonimizar.`;
}

/** Efecto en la cuenta de revocar (mismos efectos que POST /consentimientos): promociones apagadas y salud en null. */
function efectosDeRevocar(tipos: ReadonlyArray<ConsentimientoRevocable>): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  if (tipos.includes('promociones')) cambios.recibePromociones = false;
  if (tipos.includes('datos_salud')) Object.assign(cambios, CAMPOS_SALUD_EN_NULL);
  return cambios;
}

const solicitudCambio = () =>
  new ConflictException({
    message: 'La solicitud cambió mientras la atendías: recarga la bandeja y revisa su estado.',
    code: 'SOLICITUD_CAMBIO',
  });

/**
 * Derechos ARCO (acceso, rectificación, cancelación, oposición y revocación). Plazos con días hábiles del salón
 * (common/utils/dias-habiles.util.ts): respuesta en 20 desde la recepción y efectividad en 15 desde la respuesta.
 */
@Injectable()
export class ArcoService {
  // Sin datos personales en el log: solo el folio de la solicitud y el nombre del error.
  private readonly logger = new Logger(ArcoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** POST /arco/solicitudes: el folio lo genera la base. Una sola cancelación abierta por persona. */
  async crearSolicitud(usuarioId: string, dto: CrearSolicitudArcoDto, ahora: Date = new Date()) {
    if (dto.tipo === 'cancelacion') {
      const abierta = await this.prisma.solicitudArco.findFirst({
        where: { usuarioId, tipo: 'cancelacion', estado: { notIn: [...ESTADOS_CERRADOS] } },
        orderBy: { creadaEn: 'asc' },
        select: { folio: true },
      });
      if (abierta) {
        throw new ConflictException({
          message: `Ya tienes una solicitud de cancelación abierta con folio ${abierta.folio}.`,
          code: 'CANCELACION_ABIERTA',
        });
      }
    }
    const solicitud = await this.prisma.solicitudArco.create({
      data: {
        usuarioId,
        tipo: dto.tipo,
        descripcion: dto.descripcion ? sanitizeInput(dto.descripcion) || null : null,
        creadaEn: ahora,
        venceRespuesta: sumarDiasHabiles(ahora, DIAS_HABILES_RESPUESTA),
      },
      select: SELECT_SOLICITUD_PROPIA,
    });
    return { success: true, data: solicitud };
  }

  /** GET /arco/mias */
  async mias(usuarioId: string) {
    const solicitudes = await this.prisma.solicitudArco.findMany({
      where: { usuarioId },
      orderBy: { creadaEn: 'desc' },
      select: SELECT_SOLICITUD_PROPIA,
    });
    return { success: true, data: solicitudes };
  }

  /**
   * GET /arco/mis-datos: todos los datos personales propios en JSON (derecho de acceso): perfil (con datos de salud),
   * direcciones, pedidos, citas, consentimientos, solicitudes ARCO, ventas en el salón con sus artículos, facturas,
   * quejas, valoraciones, tarjetas guardadas (marca, últimos 4 y vencimiento), cotizaciones, observaciones y
   * seguimientos del personal, devoluciones, pagos (de pedidos y anticipos de citas), notificaciones y preferencias de
   * notificación. Nunca contraseñas, tokens, códigos, respuestas de seguridad ni el payload de la pasarela.
   */
  async misDatos(usuarioId: string) {
    const [
      perfil,
      direcciones,
      pedidos,
      citas,
      consentimientos,
      solicitudesArco,
      ventasSalon,
      facturas,
      quejas,
      valoraciones,
      metodosPago,
      cotizaciones,
      observaciones,
      seguimientos,
      devoluciones,
      pagos,
      notificaciones,
      preferenciasNotificacion,
    ] = await Promise.all([
      this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: SELECT_MIS_DATOS }),
      this.prisma.direccionUsuario.findMany({ where: { usuarioId }, orderBy: { creadoEn: 'asc' } }),
      this.prisma.pedido.findMany({
        where: { usuarioId },
        orderBy: { creadoEn: 'desc' },
        include: {
          items: { select: { id: true, nombreProducto: true, tamanio: true, cantidad: true, precioUnitario: true, subtotal: true } },
        },
      }),
      this.prisma.cita.findMany({
        where: { clienteId: usuarioId },
        orderBy: { fechaHoraInicio: 'desc' },
        include: { servicio: { select: { id: true, nombre: true } }, especialista: { select: { id: true, nombre: true } } },
      }),
      this.prisma.consentimiento.findMany({ where: { usuarioId }, orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }] }),
      this.prisma.solicitudArco.findMany({ where: { usuarioId }, orderBy: { creadaEn: 'desc' }, select: SELECT_SOLICITUD_PROPIA }),
      this.prisma.ventaLocal.findMany({ where: { clienteId: usuarioId }, orderBy: { creadoEn: 'desc' }, select: SELECT_VENTA_MIS_DATOS }),
      this.prisma.factura.findMany({ where: { pedido: { usuarioId } }, orderBy: { creadoEn: 'desc' }, select: SELECT_FACTURA_MIS_DATOS }),
      this.prisma.queja.findMany({ where: { usuarioId }, orderBy: { creadoEn: 'desc' } }),
      this.prisma.valoracion.findMany({
        where: { usuarioId },
        orderBy: { creadoEn: 'desc' },
        include: { producto: { select: { id: true, nombre: true } } },
      }),
      this.prisma.metodoPagoUsuario.findMany({ where: { usuarioId }, orderBy: { creadoEn: 'asc' }, select: SELECT_TARJETA_MIS_DATOS }),
      this.prisma.cotizacion.findMany({
        where: { clienteId: usuarioId },
        orderBy: { creadoEn: 'desc' },
        include: { paquete: { select: { id: true, tipo_evento: true } } },
      }),
      this.prisma.observacionCliente.findMany({ where: { clienteId: usuarioId }, orderBy: { creadoEn: 'desc' }, select: SELECT_OBSERVACION_MIS_DATOS }),
      this.prisma.seguimientoPostServicio.findMany({ where: { usuarioId }, orderBy: { fechaContacto: 'desc' }, select: SELECT_SEGUIMIENTO_MIS_DATOS }),
      this.prisma.devolucion.findMany({ where: { pedido: { usuarioId } }, orderBy: { creadoEn: 'desc' }, select: SELECT_DEVOLUCION_MIS_DATOS }),
      this.prisma.pago.findMany({
        where: { OR: [{ pedido: { usuarioId } }, { cita: { clienteId: usuarioId } }] },
        orderBy: { creadoEn: 'desc' },
        select: SELECT_PAGO_MIS_DATOS,
      }),
      this.prisma.notificacion.findMany({ where: { usuarioId }, orderBy: { creadoEn: 'desc' }, select: SELECT_NOTIFICACION_MIS_DATOS }),
      this.prisma.preferenciaNotificacion.findMany({
        where: { usuarioId },
        orderBy: [{ tipo: 'asc' }, { canal: 'asc' }],
        select: SELECT_PREFERENCIA_MIS_DATOS,
      }),
    ]);
    if (!perfil) throw new NotFoundException('No encontramos tu cuenta.');
    return {
      success: true,
      data: {
        generadoEn: new Date().toISOString(),
        perfil,
        direcciones,
        pedidos,
        citas,
        consentimientos: consentimientos.map(serializarConsentimiento),
        solicitudesArco,
        ventasSalon,
        facturas,
        quejas,
        valoraciones,
        metodosPago,
        cotizaciones,
        observaciones,
        seguimientos,
        devoluciones,
        pagos,
        notificaciones,
        preferenciasNotificacion,
      },
    };
  }

  /**
   * POST /arco/oposicion { finalidad: 'promociones' }: se aplica de inmediato (recibePromociones=false), queda la
   * evidencia como consentimiento revocado (desde el perfil) y la solicitud se registra ya atendida. Todo en una
   * transacción.
   */
  async oposicion(usuarioId: string, _dto: OposicionArcoDto, contexto: ContextoPeticion, ahora: Date = new Date()) {
    const solicitud = await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: usuarioId }, data: { recibePromociones: false } });
      await tx.consentimiento.create({
        data: filaConsentimiento({
          usuarioId,
          tipo: 'promociones',
          accion: 'revocado',
          documento: null,
          formulario: 'arco_oposicion',
          rutaOrigen: '/perfil',
          contexto,
        }),
      });
      return tx.solicitudArco.create({
        data: {
          usuarioId,
          tipo: 'oposicion',
          descripcion: 'Oposición al uso de mis datos para enviarme promociones.',
          estado: 'atendida',
          creadaEn: ahora,
          venceRespuesta: sumarDiasHabiles(ahora, DIAS_HABILES_RESPUESTA),
          respuesta: 'Aplicada de inmediato: ya no recibirás promociones.',
          respondidaEn: ahora,
          atendidaEn: ahora,
        },
        select: SELECT_SOLICITUD_PROPIA,
      });
    }, TX_HOLGADA);
    return { success: true, data: solicitud };
  }

  /**
   * GET /arco/solicitudes (admin): filtros por estado y vencidas, paginada, con los datos de la persona. Misma regla que
   * el campo `vencida` de cada fila (estaVencida):
   * - vencidas=true: abiertas (recibida, en_proceso) con vence_respuesta ya pasado, o respondidas con vence_efectividad
   *   ya pasado.
   * - vencidas=false: las que NO están vencidas: abiertas con vence_respuesta igual o posterior a este momento,
   *   respondidas con vence_efectividad igual o posterior (o sin él), y todas las cerradas (atendida, rechazada), que
   *   ya no corren plazo.
   * - sin el filtro: todas.
   */
  async listarAdmin(filtros: { estado?: EstadoArco; vencidas?: string; page?: string; limit?: string }, ahora: Date = new Date()) {
    const page = aEntero(filtros.page, 1, 1, 1_000_000);
    const limit = aEntero(filtros.limit, LIMITE_POR_DEFECTO, 1, LIMITE_MAXIMO);
    const where: Record<string, unknown> = {};
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.vencidas === 'true') {
      where.OR = [
        { estado: { in: ['recibida', 'en_proceso'] }, venceRespuesta: { lt: ahora } },
        { estado: 'respondida', venceEfectividad: { lt: ahora } },
      ];
    } else if (filtros.vencidas === 'false') {
      // Lo contrario de estaVencida, escrito en positivo (un NOT con vence_efectividad nula dejaría fuera filas)
      where.OR = [
        { estado: { in: ['recibida', 'en_proceso'] }, venceRespuesta: { gte: ahora } },
        { estado: 'respondida', OR: [{ venceEfectividad: null }, { venceEfectividad: { gte: ahora } }] },
        { estado: { in: ESTADOS_CERRADOS } },
      ];
    }
    const [solicitudes, total] = await Promise.all([
      this.prisma.solicitudArco.findMany({
        where,
        orderBy: [{ venceRespuesta: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          usuario: { select: { id: true, nombre: true, email: true, telefono: true } },
          atendidaPor: { select: { id: true, nombre: true } },
        },
      }),
      this.prisma.solicitudArco.count({ where }),
    ]);
    return {
      success: true,
      data: solicitudes.map((s: any) => ({ ...s, vencida: estaVencida(s, ahora) })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * PATCH /arco/solicitudes/:id (admin).
   * - El cambio es atómico: se actualiza solo si la solicitud sigue en el estado que se leyó (si no, 409).
   * - respondida guarda respondida_en y vence_efectividad (15 días hábiles) la primera vez; volver a responder solo
   *   cambia el texto. Una respondida no regresa a en_proceso.
   * - rechazada también es una respuesta; atendida exige respuesta (la nueva o la ya dada) y guarda quién y cuándo.
   * - Revocación atendida: `revocar` dice qué consentimientos se revocan; se inserta una fila "revocado" por cada uno
   *   y se aplican sus efectos en la misma transacción. Oposición atendida: igual con promociones.
   * - La cancelación solo se atiende con ejecutar-cancelacion, para que no quede atendida sin anonimizar la cuenta.
   * - Al responder, atender o rechazar se avisa a la titular por correo después de guardar (si falla, la respuesta
   *   queda guardada y la respuesta HTTP lo dice con correoEnviado=false).
   */
  async actualizarAdmin(id: number, dto: ActualizarSolicitudArcoDto, adminId: string, contexto: ContextoPeticion, ahora: Date = new Date()) {
    const actual = await this.prisma.solicitudArco.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Solicitud ARCO no encontrada');
    if (ESTADOS_CERRADOS.includes(actual.estado)) throw new BadRequestException('La solicitud ya está cerrada.');
    if (actual.tipo === 'cancelacion' && dto.estado === 'atendida') {
      throw new BadRequestException('Una solicitud de cancelación se atiende con "ejecutar cancelación", que anonimiza la cuenta.');
    }
    if (!(TRANSICIONES[actual.estado] ?? []).includes(dto.estado)) {
      throw new BadRequestException(
        `Una solicitud ${ETIQUETA_ESTADO[actual.estado] ?? actual.estado} no puede pasar a "${ETIQUETA_ESTADO[dto.estado] ?? dto.estado}".`,
      );
    }
    const respuesta = dto.respuesta === undefined ? undefined : sanitizeInput(dto.respuesta);
    if ((dto.estado === 'respondida' || dto.estado === 'rechazada') && !respuesta) {
      throw new BadRequestException('Escribe la respuesta para la titular.');
    }
    if (dto.estado === 'atendida' && !respuesta && !actual.respuesta) {
      throw new BadRequestException('Escribe la respuesta para la titular.');
    }
    const revocar = dto.revocar ?? [];
    const atiendeRevocacion = actual.tipo === 'revocacion' && dto.estado === 'atendida';
    if (atiendeRevocacion && revocar.length === 0) throw new BadRequestException('Elige qué consentimientos se revocan.');
    if (!atiendeRevocacion && revocar.length > 0) {
      throw new BadRequestException('Los consentimientos a revocar solo se eligen al atender una solicitud de revocación.');
    }
    const aRevocar: ConsentimientoRevocable[] = atiendeRevocacion
      ? revocar
      : actual.tipo === 'oposicion' && dto.estado === 'atendida'
        ? ['promociones']
        : [];

    const data: Record<string, unknown> = { estado: dto.estado };
    if (respuesta) data.respuesta = respuesta;
    if (dto.estado === 'respondida') {
      // La primera respuesta fija el plazo de efectividad; volver a responder no lo reinicia
      if (!actual.respondidaEn) data.respondidaEn = ahora;
      if (!actual.venceEfectividad) data.venceEfectividad = sumarDiasHabiles(actual.respondidaEn ?? ahora, DIAS_HABILES_EFECTIVIDAD);
    }
    if ((dto.estado === 'rechazada' || dto.estado === 'atendida') && !actual.respondidaEn) data.respondidaEn = ahora;
    if (dto.estado === 'atendida') {
      data.atendidaEn = ahora;
      data.atendidaPorId = adminId;
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.solicitudArco.updateMany({ where: { id, estado: actual.estado }, data });
      if (count !== 1) throw solicitudCambio();
      if (aRevocar.length > 0) await this.revocarDesdeBandeja(tx, actual.usuarioId, aRevocar, adminId, contexto);
    }, TX_HOLGADA);
    const solicitud = { ...actual, ...data } as typeof actual;

    if (!ESTADOS_CON_AVISO.includes(dto.estado)) return { success: true, data: solicitud };
    const correoEnviado = await this.avisarRespuesta(solicitud);
    return { success: true, data: solicitud, correoEnviado };
  }

  /**
   * POST /arco/solicitudes/:id/ejecutar-cancelacion (admin, solo tipo cancelacion).
   *
   * Antes de anonimizar: solo cuentas de clienta (409 si es del personal) y sin pedidos sin terminar, citas activas que
   * no han terminado ni devoluciones pendientes (409 con el detalle).
   *
   * En UNA transacción (la solicitud se marca atendida primero y de forma atómica): datos personales, de salud y
   * capilares en null, cuenta inactiva y sesiones revocadas; borra tarjetas guardadas, carrito, dispositivos push,
   * sesiones de la app, preferencias de notificación, cambios de correo pendientes, notificaciones y observaciones del
   * personal; anonimiza sus direcciones; vacía la dirección y las notas de sus pedidos, las notas de sus citas, de sus
   * seguimientos y de sus ventas en el salón; en sus cotizaciones deja "Cuenta cancelada" sin notas.
   *
   * CONSERVA pedidos, pagos, facturas y ventas (5 años, art. 30 del Código Fiscal de la Federación), citas, quejas y
   * valoraciones (sin nombre: la cuenta queda anonimizada), consentimientos y solicitudes ARCO.
   *
   * Después del COMMIT se confirma por correo a la dirección que tenía la cuenta antes de anonimizarla.
   */
  async ejecutarCancelacion(id: number, adminId: string, ahora: Date = new Date()) {
    const solicitud = await this.prisma.solicitudArco.findUnique({ where: { id } });
    if (!solicitud) throw new NotFoundException('Solicitud ARCO no encontrada');
    if (solicitud.tipo !== 'cancelacion') throw new BadRequestException('Solo las solicitudes de cancelación se ejecutan así.');
    if (ESTADOS_CERRADOS.includes(solicitud.estado)) throw new BadRequestException('La solicitud ya está cerrada.');
    const usuarioId = solicitud.usuarioId;

    const titular = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { email: true, rol: true } });
    if (!titular) throw new NotFoundException('No encontramos la cuenta de la titular.');
    if (titular.rol !== 'cliente') {
      throw new ConflictException({ message: 'Esta cuenta es del personal: primero quítale el rol de personal.', code: 'CUENTA_DE_PERSONAL' });
    }
    const [pedidos, citas, devoluciones] = await Promise.all([
      this.prisma.pedido.count({ where: { usuarioId, estado: { notIn: ESTADOS_PEDIDO_TERMINADO } } }),
      this.prisma.cita.count({
        where: { clienteId: usuarioId, OR: [{ estado: { in: ESTADOS_CITA_ACTIVA }, fechaHoraFin: { gte: ahora } }, { estado: 'en_curso' }] },
      }),
      this.prisma.devolucion.count({ where: { pedido: { usuarioId }, estado: 'pendiente' } }),
    ]);
    const enCurso = mensajeOperacionesEnCurso({ pedidos, citas, devoluciones });
    if (enCurso) throw new ConflictException({ message: enCurso, code: 'OPERACIONES_EN_CURSO' });
    // Se guarda ANTES de anonimizar: después la cuenta ya no tiene su correo
    const correoOriginal = titular.email;

    await this.prisma.$transaction(async (tx) => {
      // Primero se toma la solicitud: si otra persona ya la ejecutó, nada de lo demás se escribe
      const { count } = await tx.solicitudArco.updateMany({
        where: { id, estado: solicitud.estado },
        data: {
          estado: 'atendida',
          atendidaEn: ahora,
          atendidaPorId: adminId,
          respondidaEn: solicitud.respondidaEn ?? ahora,
          respuesta: solicitud.respuesta ?? RESPUESTA_CANCELACION,
        },
      });
      if (count !== 1) throw solicitudCambio();
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          nombre: NOMBRE_ANONIMO,
          email: `cancelada-${usuarioId}${DOMINIO_ANONIMO}`,
          telefono: null,
          foto: null,
          googleId: null,
          fechaNacimiento: null,
          preguntaSeguridad: null,
          respuestaSeguridad: null,
          password: null,
          resetPasswordToken: null,
          resetPasswordExpires: null,
          codigoOTP: null,
          otpExpira: null,
          tipoCabello: null,
          colorNatural: null,
          colorActual: null,
          productosUsados: null,
          alergias: null,
          // Columna NOT NULL: false es su valor "sin dato"
          tratamientosQuimicos: false,
          tratamientos: null,
          recibePromociones: false,
          activo: false,
          tokensRevocadosDesde: ahora,
        },
      });
      await tx.metodoPagoUsuario.deleteMany({ where: { usuarioId } });
      await tx.carritoItem.deleteMany({ where: { usuarioId } });
      await tx.direccionUsuario.updateMany({ where: { usuarioId }, data: DIRECCION_ANONIMA });
      // Sin obligación de conservarse: tokens push y sesiones de la app, preferencias de notificación, cambios de correo
      // pendientes (traen el correo nuevo), sus notificaciones y las observaciones del personal sobre ella.
      await tx.dispositivoPush.deleteMany({ where: { usuarioId } });
      await tx.sesionMovil.deleteMany({ where: { usuarioId } });
      await tx.preferenciaNotificacion.deleteMany({ where: { usuarioId } });
      await tx.solicitudCambioCorreo.deleteMany({ where: { usuarioId } });
      await tx.notificacion.deleteMany({ where: { usuarioId } });
      await tx.observacionCliente.deleteMany({ where: { clienteId: usuarioId } });
      // Se conservan sin lo que no es fiscal: dirección y notas del pedido, notas de citas, seguimientos y ventas, y el
      // nombre de las cotizaciones (montos, estados y fechas quedan).
      await tx.pedido.updateMany({ where: { usuarioId }, data: { direccionTextoCompleta: null, notasCliente: null } });
      await tx.cita.updateMany({ where: { clienteId: usuarioId }, data: { notas: null } });
      await tx.cotizacion.updateMany({ where: { clienteId: usuarioId }, data: { clienteNombre: NOMBRE_ANONIMO, notas: null } });
      // seguimientos_post_servicio.notas es NOT NULL: el texto vacío es su valor "sin dato"
      await tx.seguimientoPostServicio.updateMany({ where: { usuarioId }, data: { notas: '' } });
      await tx.ventaLocal.updateMany({ where: { clienteId: usuarioId }, data: { notas: null } });
    }, TX_HOLGADA);

    const correoEnviado = await this.confirmarCancelacion(correoOriginal, solicitud.folio, ahora);
    return { success: true, message: 'Cuenta anonimizada y solicitud atendida.', data: { folio: solicitud.folio, correoEnviado } };
  }

  /**
   * Filas "revocado" de la bandeja (una por tipo, con el admin que las registró) y sus efectos en la cuenta, dentro de
   * la transacción recibida.
   */
  private async revocarDesdeBandeja(
    tx: Prisma.TransactionClient,
    usuarioId: string,
    tipos: ReadonlyArray<ConsentimientoRevocable>,
    registradoPorId: string,
    contexto: ContextoPeticion,
  ) {
    for (const tipo of tipos) {
      await tx.consentimiento.create({
        data: {
          ...filaConsentimiento({
            usuarioId,
            tipo,
            accion: 'revocado',
            documento: null,
            formulario: FORMULARIO_BANDEJA,
            rutaOrigen: RUTA_BANDEJA,
            contexto,
          }),
          registradoPorId,
        },
      });
    }
    const cambios = efectosDeRevocar(tipos);
    if (Object.keys(cambios).length > 0) await tx.usuario.update({ where: { id: usuarioId }, data: cambios });
  }

  /** Correo a la titular con folio, estado y respuesta. true si salió; si falla, se registra sin datos personales. */
  private async avisarRespuesta(s: { folio: string; tipo: string; estado: string; respuesta: string | null; usuarioId: string }): Promise<boolean> {
    try {
      const titular = await this.prisma.usuario.findUnique({ where: { id: s.usuarioId }, select: { email: true } });
      if (!titular?.email || esCorreoAnonimo(titular.email)) return false;
      await this.email.sendRespuestaArcoEmail(titular.email, { folio: s.folio, tipo: s.tipo, estado: s.estado, respuesta: s.respuesta ?? '' });
      return true;
    } catch (error) {
      this.logger.warn(`No se pudo avisar por correo la respuesta de la solicitud ${s.folio} (${(error as Error)?.name ?? 'Error'})`);
      return false;
    }
  }

  /** Confirmación de la cancelación al correo original. true si salió; si falla, se registra sin datos personales. */
  private async confirmarCancelacion(correo: string, folio: string, ahora: Date): Promise<boolean> {
    if (!correo || esCorreoAnonimo(correo)) return false;
    try {
      await this.email.sendCancelacionCuentaArcoEmail(correo, { folio, fecha: ahora });
      return true;
    } catch (error) {
      this.logger.warn(`No se pudo mandar la confirmación de la cancelación de la solicitud ${folio} (${(error as Error)?.name ?? 'Error'})`);
      return false;
    }
  }
}
