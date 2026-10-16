import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TX_HOLGADA } from '../pos/salidas-caja';
import { EVENTO_ANTICIPO_POR_DEVOLVER, type MotivoAnticipoPorDevolver } from '../citas/anticipos/anticipos.util';
import { OutboxService } from './outbox.service';
import { ResolverDestinatariosService } from './resolver-destinatarios.service';
import { DespachadorService } from './despachador.service';
import { esPagoEnSalon } from '../ecommerce/pedidos/flujo-pedido';
import { reglasDeCita, reglasDePedido, reglasNegocio } from '../configuracion-sitio/reglas-negocio';
import { plantillaTexto, textoSitio, variablesDeTexto } from '../textos-sitio/textos-sitio.util';
import {
  EVENTO_ARCO_RESPONDIDA,
  EVENTO_ARCO_SOLICITUD_CREADA,
  EVENTO_REEMBOLSO_REALIZADO,
  type ArcoRespondidaEvent,
  type ArcoSolicitudCreadaEvent,
  type ReembolsoRealizadoEvent,
} from './eventos';

export interface CitaCreadaEvent {
  citaId: number;
  /** null en citas sin cita de una persona sin cuenta: no hay a quién avisar. */
  clienteId: string | null;
  especialistaId: string;
  servicioNombre: string;
  fechaHoraInicio: Date;
}

export interface CitaCanceladaEvent {
  citaId: number;
  /** null en citas sin cita de una persona sin cuenta: no hay a quién avisar. */
  clienteId: string | null;
  especialistaId: string;
  motivo: string;
}

export interface CitaReprogramadaEvent {
  citaId: number;
  /** null en citas sin cita de una persona sin cuenta: no hay a quién avisar. */
  clienteId: string | null;
  especialistaId: string;
  servicioNombre: string;
  fechaHoraInicioNueva: Date;
}

export interface VentaLocalPagadaEvent {
  ventaId: number;
  clienteId: string;
  folio: string;
  total: number;
  creadoEn: Date;
}

/** Común a los 4 eventos de pedidos online: un solo destinatario (el dueño del
 *  pedido), sin cascada a otros roles: a diferencia de citas, aquí no hay un
 *  segundo actor (especialista) que notificar. */
export interface PagoRevisionEvent {
  /** Pago de un pedido o del anticipo de una cita (uno de los dos). */
  pedidoId?: number;
  citaId?: number;
  referencia: string;
  motivo: 'pedido_no_pendiente' | 'monto_distinto' | 'cita_no_vigente' | 'cita_cancelada_por_clienta';
  estadoPedido?: string;
  estadoCita?: string;
}

export interface PedidoEvent {
  pedidoId: number;
  usuarioId: string;
}

/** La clienta canceló un pedido ya pagado (PedidosService.actualizar): qué pasó con su dinero. */
export interface PedidoCanceladoPagadoEvent extends PedidoEvent {
  /** Nombre (o correo) de la clienta, para que el personal la reconozca. */
  clienta: string;
  monto: number;
  reembolso: 'reembolsado' | 'en_revision';
}

/** La clienta revocó la compra de un pedido que ya tiene (PedidosService.revocar): el personal debe recibirlo. */
export interface RevocacionPorRecibirEvent extends PedidoEvent {
  devolucionId: number;
  monto: number;
}

/** Anticipo de una cancelación a tiempo que el personal debe devolver (AnticiposCitasService.alCancelarConReembolso). */
export interface AnticipoPorDevolverEvent {
  citaId: number;
  motivo: MotivoAnticipoPorDevolver;
}

/** Quien recibe el producto de una revocación (devoluciones:gestionar) y quien devuelve un anticipo (caja). */
const PERMISO_GESTIONAR_DEVOLUCIONES = 'devoluciones:gestionar';
const PERMISO_CAJA = 'caja:escritura';
/** Quien agenda y gestiona cualquier cita (recepción, estilista; el admin siempre). */
const PERMISO_CITAS = 'citas:escritura';
/** Quien prepara y entrega los pedidos en línea. */
const PERMISO_PEDIDOS = 'pedidos:entregar';
/** Quien atiende los reembolsos pendientes (por omisión solo el admin). */
const PERMISO_REEMBOLSOS = 'reembolsos:gestionar';
/** Clave de acceso total: solo admin (mismo criterio que @Permisos('*') en ARCO). */
const PERMISO_ADMIN = '*';

/** Pantallas que abre cada aviso (la web y la app las usan como destino del clic). */
const RUTA_GESTION_CITAS = '/operacion/gestion-citas';
const RUTA_PEDIDOS_ONLINE = '/operacion/pedidos-online';
const RUTA_SOLICITUDES_ARCO = '/admin/solicitudes-arco';
const RUTA_MIS_SOLICITUDES_ARCO = '/cliente/mi-perfil#privacidad-solicitudes';
const rutaMiCita = (citaId: number) => `/cliente/servicios-citas/mis-citas/${citaId}`;
const rutaMiPedido = (pedidoId: number) => `/cliente/tienda-online/mis-pedidos/${pedidoId}`;

const ETIQUETA_TIPO_ARCO: Readonly<Record<string, string>> = {
  acceso: 'acceso',
  rectificacion: 'rectificación',
  cancelacion: 'cancelación',
  oposicion: 'oposición',
  revocacion: 'revocación del consentimiento',
};
const MENSAJE_ESTADO_ARCO: Readonly<Record<string, string>> = {
  respondida: 'ya tiene respuesta',
  atendida: 'quedó atendida',
  rechazada: 'fue rechazada; revisa el motivo',
};

const formatoMonto = (monto: number) =>
  `$${monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Tipo usado tanto al programar los 2 recordatorios en `onCitaCreada` como al
 *  identificarlos para descartarlos en la cascada de `onCitaCancelada`:
 *  cambiarlo en un solo lado rompe esa cascada silenciosamente. */
const TIPO_RECORDATORIO_CITA = 'cita_recordatorio';
/** Variables de reglas que guarda cada cita (reglasDeCita): en sus avisos ganan a las reglas de hoy. */
const VARIABLES_DE_CITA: ReadonlySet<string> = new Set([
  'plazoAnticipoHoras',
  'minutosAntesPagoSalon',
  'horasAvisoCancelarReagendar',
  'diasHabilesExcepcionAnticipo',
  'diasHabilesCancelarConReembolso',
]);
/** Variables de reglas que guarda cada pedido (variablesDePedido): en sus avisos ganan a las reglas de hoy. */
const VARIABLES_DE_PEDIDO: ReadonlySet<string> = new Set([
  'plazoPagoLineaHoras',
  'diasPrepararApartado',
  'diaRecordatorioRecoger',
  'diasCancelarNoRecogido',
  'diasRestantesRecoger',
  'diasResguardo',
  'diasCambioProducto',
  'diasHabilesRevocacion',
]);
/** Horas antes de la cita de Configuración del sitio > Reglas (hoy 24 y 1). */
const recordatoriosAntesMs = () => reglasNegocio().citas.recordatoriosHorasAntes.map((h) => h * 60 * 60_000);

@Injectable()
export class NotificacionesListener {
  private readonly logger = new Logger(NotificacionesListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly resolver: ResolverDestinatariosService,
    private readonly despachador: DespachadorService,
  ) {}

  /**
   * Transacción del outbox (notificación + envíos) con tiempo holgado: con la latencia a Neon, los 5 s por
   * defecto de Prisma no alcanzaban ("Transaction already closed") y el aviso se perdía aunque la operación
   * principal ya se hubiera hecho. Mismo tiempo que TX_HOLGADA.
   */
  private enOutbox<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, TX_HOLGADA);
  }

  @OnEvent('cita.creada')
  async onCitaCreada(payload: CitaCreadaEvent): Promise<void> {
    const fecha = this.formatearFecha(payload.fechaHoraInicio);
    const envioIds: string[] = [];

    const clienteId = payload.clienteId;
    const contextoCita = { servicio: payload.servicioNombre, fecha, cita: payload.citaId };
    const mensajeCreada = await this.textoDeCita('avisos.citaCreada.mensaje', payload.citaId, contextoCita);
    const mensajeRecordatorio = await this.textoDeCita('avisos.citaRecordatorio.mensaje', payload.citaId, contextoCita);
    await this.enOutbox(async (tx) => {
      if (clienteId) {
        const canalesCliente = await this.resolver.resolverCanales(clienteId, 'cita_creada', ['in_app']);
        const { envios: enviosCliente } = await this.outbox.encolar(tx, {
          usuarioId: clienteId,
          tipo: 'cita_creada',
          titulo: textoSitio('avisos.citaCreada.titulo'),
          mensaje: mensajeCreada,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
          urlAccion: rutaMiCita(payload.citaId),
          canales: canalesCliente,
        });
        envioIds.push(...enviosCliente.map((e) => e.id));
      }

      const canalesEspecialista = await this.resolver.resolverCanales(payload.especialistaId, 'cita_asignada', [
        'in_app',
      ]);
      const { envios: enviosEspecialista } = await this.outbox.encolar(tx, {
        usuarioId: payload.especialistaId,
        tipo: 'cita_asignada',
        titulo: textoSitio('avisos.citaAsignada.titulo'),
        mensaje: textoSitio('avisos.citaAsignada.mensaje', { servicio: payload.servicioNombre, fecha }),
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        urlAccion: RUTA_GESTION_CITAS,
        canales: canalesEspecialista,
      });
      envioIds.push(...enviosEspecialista.map((e) => e.id));

      // Recordatorios (horas antes de la regla): NO se agregan a `envioIds`: deben
      // quedar 'pendiente' hasta que el barrido (`BarridoService`, cada 5 min)
      // los recoja cuando venza su `programadoPara`. Si se pasaran a
      // `drenarInmediatas` de abajo, `drenar()` los despacharía ahora mismo
      // (no filtra por `programadoPara`), rompiendo el propósito de programarlos.
      const ahora = Date.now();
      for (const antesMs of clienteId ? recordatoriosAntesMs() : []) {
        const programadoPara = new Date(payload.fechaHoraInicio.getTime() - antesMs);
        if (programadoPara.getTime() <= ahora) continue; // la cita se creó con menos antelación que este recordatorio

        const canalesRecordatorio = await this.resolver.resolverCanales(
          clienteId as string,
          TIPO_RECORDATORIO_CITA,
          ['in_app', 'email'],
        );
        await this.outbox.encolar(tx, {
          usuarioId: clienteId as string,
          tipo: TIPO_RECORDATORIO_CITA,
          titulo: textoSitio('avisos.citaRecordatorio.titulo'),
          mensaje: mensajeRecordatorio,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
          urlAccion: rutaMiCita(payload.citaId),
          programadoPara,
          canales: canalesRecordatorio,
        });
      }
    });

    this.despachador.drenarInmediatas(envioIds);
  }

  @OnEvent('cita.cancelada')
  async onCitaCancelada(payload: CitaCanceladaEvent): Promise<void> {
    const envioIds: string[] = [];

    const clienteId = payload.clienteId;
    await this.enOutbox(async (tx) => {
      if (clienteId) {
        const canalesCliente = await this.resolver.resolverCanales(clienteId, 'cita_cancelada', ['in_app']);
        const { envios: enviosCliente } = await this.outbox.encolar(tx, {
          usuarioId: clienteId,
          tipo: 'cita_cancelada',
          titulo: textoSitio('avisos.citaCancelada.titulo'),
          mensaje: textoSitio('avisos.citaCancelada.mensajeClienta', { motivo: payload.motivo }),
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
          urlAccion: rutaMiCita(payload.citaId),
          canales: canalesCliente,
        });
        envioIds.push(...enviosCliente.map((e) => e.id));
      }

      const canalesEspecialista = await this.resolver.resolverCanales(
        payload.especialistaId,
        'cita_cancelada',
        ['in_app'],
      );
      const { envios: enviosEspecialista } = await this.outbox.encolar(tx, {
        usuarioId: payload.especialistaId,
        tipo: 'cita_cancelada',
        titulo: textoSitio('avisos.citaCancelada.titulo'),
        mensaje: textoSitio('avisos.citaCancelada.mensajeEspecialista', { motivo: payload.motivo }),
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        urlAccion: RUTA_GESTION_CITAS,
        canales: canalesEspecialista,
      });
      envioIds.push(...enviosEspecialista.map((e) => e.id));

      // Cascada: recordatorios pendientes de ESTA cita ya no aplican. No-op hoy
      // porque nada crea notificaciones de tipo TIPO_RECORDATORIO_CITA todavía.
      await tx.notificacionEnvio.updateMany({
        where: {
          estado: 'pendiente',
          notificacion: {
            entidadTipo: 'cita',
            entidadId: String(payload.citaId),
            tipo: TIPO_RECORDATORIO_CITA,
          },
        },
        data: { estado: 'descartada' },
      });
    });

    this.despachador.drenarInmediatas(envioIds);
  }

  @OnEvent('cita.reprogramada')
  async onCitaReprogramada(payload: CitaReprogramadaEvent): Promise<void> {
    const fecha = this.formatearFecha(payload.fechaHoraInicioNueva);
    const envioIds: string[] = [];
    const clienteId = payload.clienteId;
    const contextoCita = { servicio: payload.servicioNombre, fecha, cita: payload.citaId };
    const mensajeReprogramada = await this.textoDeCita('avisos.citaReprogramada.mensajeClienta', payload.citaId, contextoCita);
    const mensajeRecordatorio = await this.textoDeCita('avisos.citaRecordatorio.mensaje', payload.citaId, contextoCita);

    await this.enOutbox(async (tx) => {
      // (a) Cancelar primero los recordatorios viejos (apuntan a la hora
      // anterior): debe ir ANTES de programar los nuevos de (c), o este mismo
      // updateMany también los descartaría a ellos.
      await tx.notificacionEnvio.updateMany({
        where: {
          estado: 'pendiente',
          notificacion: {
            entidadTipo: 'cita',
            entidadId: String(payload.citaId),
            tipo: TIPO_RECORDATORIO_CITA,
          },
        },
        data: { estado: 'descartada' },
      });

      // (b) Notificación inmediata a cliente + especialista: sí entran a
      // envioIds → drenarInmediatas, deben llegar ya.
      if (clienteId) {
        const canalesCliente = await this.resolver.resolverCanales(clienteId, 'cita_reprogramada', ['in_app']);
        const { envios: enviosCliente } = await this.outbox.encolar(tx, {
          usuarioId: clienteId,
          tipo: 'cita_reprogramada',
          titulo: textoSitio('avisos.citaReprogramada.titulo'),
          mensaje: mensajeReprogramada,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
          urlAccion: rutaMiCita(payload.citaId),
          canales: canalesCliente,
        });
        envioIds.push(...enviosCliente.map((e) => e.id));
      }

      const canalesEspecialista = await this.resolver.resolverCanales(
        payload.especialistaId,
        'cita_reprogramada',
        ['in_app'],
      );
      const { envios: enviosEspecialista } = await this.outbox.encolar(tx, {
        usuarioId: payload.especialistaId,
        tipo: 'cita_reprogramada',
        titulo: textoSitio('avisos.citaReprogramada.titulo'),
        mensaje: textoSitio('avisos.citaReprogramada.mensajeEspecialista', { servicio: payload.servicioNombre, fecha }),
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        urlAccion: RUTA_GESTION_CITAS,
        canales: canalesEspecialista,
      });
      envioIds.push(...enviosEspecialista.map((e) => e.id));

      // (c) Recordatorios nuevos con la fecha nueva: mismo guard de
      // antelación que onCitaCreada, y mismo cuidado: NO entran a envioIds.
      const ahora = Date.now();
      for (const antesMs of clienteId ? recordatoriosAntesMs() : []) {
        const programadoPara = new Date(payload.fechaHoraInicioNueva.getTime() - antesMs);
        if (programadoPara.getTime() <= ahora) continue;

        const canalesRecordatorio = await this.resolver.resolverCanales(
          clienteId as string,
          TIPO_RECORDATORIO_CITA,
          ['in_app', 'email'],
        );
        await this.outbox.encolar(tx, {
          usuarioId: clienteId as string,
          tipo: TIPO_RECORDATORIO_CITA,
          titulo: textoSitio('avisos.citaRecordatorio.titulo'),
          mensaje: mensajeRecordatorio,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
          urlAccion: rutaMiCita(payload.citaId),
          programadoPara,
          canales: canalesRecordatorio,
        });
      }
    });

    this.despachador.drenarInmediatas(envioIds);
  }

  @OnEvent('venta_local.pagada')
  async onVentaLocalPagada(payload: VentaLocalPagadaEvent): Promise<void> {
    let envioIds: string[] = [];

    try {
      const fecha = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(payload.creadoEn);
      const totalFmt = `$${payload.total.toLocaleString('es-MX', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

      await this.enOutbox(async (tx) => {
        const canales = await this.resolver.resolverCanales(payload.clienteId, 'venta', ['in_app']);
        const { envios } = await this.outbox.encolar(tx, {
          usuarioId: payload.clienteId,
          tipo: 'venta',
          titulo: textoSitio('avisos.venta.titulo'),
          mensaje: textoSitio('avisos.venta.mensaje', { folio: payload.folio, monto: totalFmt, fecha }),
          metadata: { ventaId: payload.ventaId, folio: payload.folio, total: payload.total },
          entidadTipo: 'venta_local',
          entidadId: String(payload.ventaId),
          canales,
        });
        envioIds = envios.map((e) => e.id);
      });
    } catch (e) {
      // Mismo contrato que el create() suelto que reemplaza: un fallo aquí
      // nunca debe afectar la venta, que ya está comprometida en BD.
      this.logger.error(`No se pudo encolar la notificación de la venta ${payload.ventaId} (no afecta la venta)`, e);
      return;
    }

    this.despachador.drenarInmediatas(envioIds);
  }

  /** La barrida canceló un apartado o un pedido en línea sin pagar (ApartadosService). */
  @OnEvent('pedido.vencido')
  async onPedidoVencido(payload: PedidoEvent & { motivo: 'apartado_sin_preparar' | 'no_recogido' | 'pago_en_linea_vencido' }): Promise<void> {
    // Los plazos son los que se guardaron en el pedido al crearlo (no los de hoy).
    const claves = {
      apartado_sin_preparar: 'avisos.pedidoVencido.sinPreparar',
      no_recogido: 'avisos.pedidoVencido.noRecogido',
      pago_en_linea_vencido: 'avisos.pedidoVencido.pagoVencido',
    };
    await this.notificarPedido(
      payload,
      { tipo: 'pedido_cancelado', titulo: textoSitio('avisos.pedidoCancelado.titulo'), mensaje: await this.textoDePedido(claves[payload.motivo], payload.pedidoId) },
      ['in_app', 'email'],
    );
  }

  /** Listo para recoger desde hace unos días (regla del pedido): recordatorio (la barrida no lo repite). */
  @OnEvent('pedido.recordatorio_recoger')
  async onPedidoRecordatorioRecoger(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(
      payload,
      {
        tipo: 'pedido_recordatorio_recoger',
        titulo: textoSitio('avisos.recordatorioRecoger.titulo'),
        mensaje: await this.textoDePedido('avisos.recordatorioRecoger.mensaje', payload.pedidoId),
      },
      ['in_app', 'email'],
    );
  }

  /** Un pago de la pasarela que no se pudo aplicar al pedido: aviso por la app a cada admin. */
  @OnEvent('pago.requiere_revision')
  async onPagoRequiereRevision(payload: PagoRevisionEvent): Promise<void> {
    if (payload.citaId) return this.avisarAnticipoEnRevision(payload);
    const mensaje = textoSitio(
      payload.motivo === 'monto_distinto'
        ? 'avisos.pagoRevision.montoDistinto'
        : payload.estadoPedido === 'cancelado'
          ? 'avisos.pagoRevision.pedidoCancelado'
          : 'avisos.pagoRevision.yaPagado',
      { pedido: payload.pedidoId },
    );
    let envioIds: string[] = [];
    try {
      // Quien gestiona reembolsos (permiso del rol) y los admin, sin repetir.
      const destinatarios = await this.destinatariosPorPermiso([PERMISO_REEMBOLSOS, PERMISO_ADMIN]);
      await this.enOutbox(async (tx) => {
        for (const usuarioId of destinatarios) {
          const canales = await this.resolver.resolverCanales(usuarioId, 'pago_revision', ['in_app']);
          const { envios } = await this.outbox.encolar(tx, {
            usuarioId,
            tipo: 'pago_revision',
            titulo: textoSitio('avisos.pagoRevision.titulo'),
            mensaje,
            metadata: { referencia: payload.referencia, motivo: payload.motivo },
            entidadTipo: 'pedido',
            entidadId: String(payload.pedidoId),
            urlAccion: '/admin/pagos',
            canales,
          });
          envioIds = envioIds.concat(envios.map((e) => e.id));
        }
      });
    } catch (e) {
      this.logger.error(`No se pudo avisar del pago en revisión del pedido ${payload.pedidoId}`, e);
      return;
    }
    this.despachador.drenarInmediatas(envioIds);
  }

  /**
   * Anticipo de cita en revisión (pago tardío de una cita liberada, monto distinto o la clienta canceló):
   * aviso a quien maneja la caja (estilista y admin) para reembolsar o retener desde Gestión de citas.
   */
  private async avisarAnticipoEnRevision(payload: PagoRevisionEvent): Promise<void> {
    const mensaje = textoSitio(
      payload.motivo === 'cita_cancelada_por_clienta'
        ? 'avisos.anticipoRevision.canceladaPorClienta'
        : payload.motivo === 'monto_distinto'
          ? 'avisos.anticipoRevision.montoDistinto'
          : 'avisos.anticipoRevision.citaLiberada',
      { cita: payload.citaId },
    );
    let envioIds: string[] = [];
    try {
      const destinatarios = await this.resolver.resolverUsuariosPorPermiso('caja:escritura');
      await this.enOutbox(async (tx) => {
        for (const usuarioId of destinatarios) {
          const canales = await this.resolver.resolverCanales(usuarioId, 'pago_revision', ['in_app']);
          const { envios } = await this.outbox.encolar(tx, {
            usuarioId,
            tipo: 'pago_revision',
            titulo: textoSitio('avisos.anticipoRevision.titulo'),
            mensaje,
            metadata: { referencia: payload.referencia, motivo: payload.motivo },
            entidadTipo: 'cita',
            entidadId: String(payload.citaId),
            urlAccion: '/operacion/gestion-citas',
            canales,
          });
          envioIds = envioIds.concat(envios.map((e) => e.id));
        }
      });
    } catch (e) {
      this.logger.error(`No se pudo avisar del anticipo en revisión de la cita ${payload.citaId}`, e);
      return;
    }
    this.despachador.drenarInmediatas(envioIds);
  }

  /**
   * La clienta canceló un pedido ya pagado: aviso por la app a quien maneja la caja (estilista y admin) para
   * no prepararlo y, si el reembolso no salió solo, reembolsarlo a mano.
   */
  @OnEvent('pedido.cancelado_pagado')
  async onPedidoCanceladoPagado(payload: PedidoCanceladoPagadoEvent): Promise<void> {
    const monto = `$${payload.monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const mensaje = textoSitio(payload.reembolso === 'reembolsado' ? 'avisos.canceladoPagado.reembolsado' : 'avisos.canceladoPagado.revision', {
      clienta: payload.clienta,
      pedido: payload.pedidoId,
      monto,
    });
    let envioIds: string[] = [];
    try {
      const destinatarios = await this.resolver.resolverUsuariosPorPermiso('caja:escritura');
      await this.enOutbox(async (tx) => {
        for (const usuarioId of destinatarios) {
          const canales = await this.resolver.resolverCanales(usuarioId, 'pedido_cancelado_pagado', ['in_app']);
          const { envios } = await this.outbox.encolar(tx, {
            usuarioId,
            tipo: 'pedido_cancelado_pagado',
            titulo: textoSitio(payload.reembolso === 'reembolsado' ? 'avisos.canceladoPagado.tituloReembolsado' : 'avisos.canceladoPagado.tituloRevision'),
            mensaje,
            metadata: { monto: payload.monto, reembolso: payload.reembolso },
            entidadTipo: 'pedido',
            entidadId: String(payload.pedidoId),
            urlAccion: '/operacion/pedidos-online',
            // Un envío por destinatario: la clave de idempotencia es por entidad, tipo y canal.
            canales: canales.map((c) => ({ ...c, discriminador: usuarioId })),
          });
          envioIds = envioIds.concat(envios.map((e) => e.id));
        }
      });
    } catch (e) {
      // Nunca afecta el pedido, que ya quedó cancelado.
      this.logger.error(`No se pudo avisar de la cancelación del pedido pagado ${payload.pedidoId}`, e);
      return;
    }
    this.despachador.drenarInmediatas(envioIds);
  }

  /**
   * La clienta revocó (art. 56 LFPC) la compra de un pedido que ya tiene (entregado o el heredado enviado): aviso
   * por la app a quien gestiona devoluciones para recibir el producto en el salón y reembolsar.
   */
  @OnEvent('pedido.revocacion_por_recibir')
  async onRevocacionPorRecibir(payload: RevocacionPorRecibirEvent): Promise<void> {
    await this.avisarPorPermiso(PERMISO_GESTIONAR_DEVOLUCIONES, {
      tipo: 'revocacion_por_recibir',
      titulo: textoSitio('avisos.revocacion.titulo'),
      mensaje: textoSitio('avisos.revocacion.mensaje', { pedido: payload.pedidoId, monto: formatoMonto(payload.monto) }),
      metadata: { devolucionId: payload.devolucionId, monto: payload.monto },
      entidadTipo: 'pedido',
      entidadId: String(payload.pedidoId),
      urlAccion: '/operacion/devoluciones',
    });
  }

  /**
   * La clienta canceló a tiempo una cita con anticipo y no se reembolsó solo (pagado en el salón, o falló el
   * reembolso automático): aviso por la app a quien maneja la caja para devolverlo desde Gestión de citas.
   */
  @OnEvent(EVENTO_ANTICIPO_POR_DEVOLVER)
  async onAnticipoPorDevolver(payload: AnticipoPorDevolverEvent): Promise<void> {
    const mensaje = textoSitio(payload.motivo === 'pagado_en_salon' ? 'avisos.anticipoPorDevolver.salon' : 'avisos.anticipoPorDevolver.fallo', {
      cita: payload.citaId,
    });
    await this.avisarPorPermiso(PERMISO_CAJA, {
      tipo: 'anticipo_por_devolver',
      titulo: textoSitio('avisos.anticipoPorDevolver.titulo'),
      mensaje,
      metadata: { motivo: payload.motivo },
      entidadTipo: 'cita',
      entidadId: String(payload.citaId),
      urlAccion: '/operacion/gestion-citas',
    });
  }

  /**
   * Aviso por la app a todo el personal con una clave de permisos_rol, un envío por destinatario (la clave de
   * idempotencia es por entidad, tipo y canal). Nunca lanza: la operación que lo originó ya se hizo.
   */
  private async avisarPorPermiso(
    clave: string | string[],
    aviso: { tipo: string; titulo: string; mensaje: string; metadata?: Prisma.InputJsonObject; entidadTipo: string; entidadId: string; urlAccion: string },
    opciones: { excluir?: Array<string | null | undefined>; sufijo?: string } = {},
  ): Promise<void> {
    let envioIds: string[] = [];
    try {
      const excluir = new Set(opciones.excluir?.filter((id): id is string => !!id));
      const destinatarios = (await this.destinatariosPorPermiso(Array.isArray(clave) ? clave : [clave])).filter(
        (id) => !excluir.has(id),
      );
      if (destinatarios.length === 0) return;
      await this.enOutbox(async (tx) => {
        for (const usuarioId of destinatarios) {
          const canales = await this.resolver.resolverCanales(usuarioId, aviso.tipo, ['in_app']);
          // Un envío por destinatario; el sufijo separa dos avisos del mismo tipo para la misma entidad.
          const discriminador = opciones.sufijo ? `${usuarioId}:${opciones.sufijo}` : usuarioId;
          const { envios } = await this.outbox.encolar(tx, {
            usuarioId,
            ...aviso,
            canales: canales.map((c) => ({ ...c, discriminador })),
          });
          envioIds = envioIds.concat(envios.map((e) => e.id));
        }
      });
    } catch (e) {
      this.logger.error(`No se pudo avisar '${aviso.tipo}' de ${aviso.entidadTipo} ${aviso.entidadId}`, e);
      return;
    }
    this.despachador.drenarInmediatas(envioIds);
  }

  /** Usuarios con cualquiera de las claves (el resolver ya suma a los admin), sin repetir y en orden. */
  private async destinatariosPorPermiso(claves: string[]): Promise<string[]> {
    const listas = await Promise.all(claves.map((c) => this.resolver.resolverUsuariosPorPermiso(c)));
    return [...new Set(listas.flat())];
  }

  /** Aviso por la app a una sola persona (la clienta). Nunca lanza: la operación que lo originó ya se hizo. */
  private async avisarA(
    usuarioId: string,
    aviso: { tipo: string; titulo: string; mensaje: string; entidadTipo: string; entidadId: string; urlAccion: string; metadata?: Prisma.InputJsonObject },
    discriminador?: string,
  ): Promise<void> {
    let envioIds: string[] = [];
    try {
      await this.enOutbox(async (tx) => {
        const canales = await this.resolver.resolverCanales(usuarioId, aviso.tipo, ['in_app']);
        const { envios } = await this.outbox.encolar(tx, {
          usuarioId,
          ...aviso,
          canales: discriminador ? canales.map((c) => ({ ...c, discriminador })) : canales,
        });
        envioIds = envios.map((e) => e.id);
      });
    } catch (e) {
      this.logger.error(`No se pudo avisar '${aviso.tipo}' de ${aviso.entidadTipo} ${aviso.entidadId}`, e);
      return;
    }
    this.despachador.drenarInmediatas(envioIds);
  }

  /** Cita nueva: aviso al personal que gestiona citas (la especialista ya recibe 'cita_asignada'). */
  @OnEvent('cita.creada')
  async onCitaNuevaPersonal(payload: CitaCreadaEvent): Promise<void> {
    await this.avisarPorPermiso(
      PERMISO_CITAS,
      {
        tipo: 'cita_nueva',
        titulo: textoSitio('avisos.citaNueva.titulo'),
        mensaje: textoSitio('avisos.citaNueva.mensaje', { servicio: payload.servicioNombre, fecha: this.formatearFecha(payload.fechaHoraInicio) }),
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        urlAccion: RUTA_GESTION_CITAS,
      },
      { excluir: [payload.especialistaId, payload.clienteId] },
    );
  }

  /** Anticipo recibido: aviso a quien maneja la caja (la clienta recibe 'cita_confirmada'). */
  @OnEvent('cita.anticipo_pagado')
  async onAnticipoPagadoPersonal(payload: { citaId: number; clienteId: string | null }): Promise<void> {
    await this.avisarPorPermiso(
      PERMISO_CAJA,
      {
        tipo: 'anticipo_pagado',
        titulo: textoSitio('avisos.anticipoPagadoPersonal.titulo'),
        mensaje: textoSitio('avisos.anticipoPagadoPersonal.mensaje', { cita: payload.citaId }),
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        urlAccion: RUTA_GESTION_CITAS,
      },
      { excluir: [payload.clienteId] },
    );
  }

  /** Pedido pagado (en línea o marcado por el personal): quien entrega pedidos lo prepara. */
  @OnEvent('pedido.pagado')
  async onPedidoNuevoPagado(payload: PedidoEvent): Promise<void> {
    await this.avisarPorPermiso(
      PERMISO_PEDIDOS,
      {
        tipo: 'pedido_nuevo',
        titulo: textoSitio('avisos.pedidoNuevo.titulo'),
        mensaje: textoSitio('avisos.pedidoNuevo.pagado', { pedido: payload.pedidoId }),
        entidadTipo: 'pedido',
        entidadId: String(payload.pedidoId),
        urlAccion: RUTA_PEDIDOS_ONLINE,
      },
      { excluir: [payload.usuarioId], sufijo: 'pagado' },
    );
  }

  /**
   * Pedido creado: solo el apartado (se paga al recoger) es trabajo nuevo para el personal desde ya; el pedido en
   * línea avisa al pagarse (onPedidoNuevoPagado), para no avisar de pedidos que nunca se pagan.
   */
  @OnEvent('pedido.creado')
  async onPedidoNuevoCreado(payload: PedidoEvent): Promise<void> {
    let pedido: { metodoPago: string | null; estado: string } | null = null;
    try {
      pedido = await this.prisma.pedido.findUnique({
        where: { id: payload.pedidoId },
        select: { metodoPago: true, estado: true },
      });
    } catch (e) {
      this.logger.error(`No se pudo leer el pedido ${payload.pedidoId} para avisar al personal`, e);
      return;
    }
    if (!pedido || pedido.estado !== 'pendiente_pago' || !esPagoEnSalon(pedido.metodoPago)) return;
    await this.avisarPorPermiso(
      PERMISO_PEDIDOS,
      {
        tipo: 'pedido_nuevo',
        titulo: textoSitio('avisos.pedidoNuevo.titulo'),
        mensaje: textoSitio('avisos.pedidoNuevo.apartado', { pedido: payload.pedidoId }),
        entidadTipo: 'pedido',
        entidadId: String(payload.pedidoId),
        urlAccion: RUTA_PEDIDOS_ONLINE,
      },
      { excluir: [payload.usuarioId], sufijo: 'apartado' },
    );
  }

  /** La clienta canceló su pedido pagado: qué pasó con su dinero (el personal recibe su propio aviso). */
  @OnEvent('pedido.cancelado_pagado')
  async onReembolsoCancelacionClienta(payload: PedidoCanceladoPagadoEvent): Promise<void> {
    const monto = formatoMonto(payload.monto);
    const hecho = payload.reembolso === 'reembolsado';
    await this.avisarA(
      payload.usuarioId,
      {
        tipo: 'reembolso',
        titulo: textoSitio(hecho ? 'avisos.reembolso.tituloHecho' : 'avisos.reembolso.tituloProceso'),
        mensaje: textoSitio(hecho ? 'avisos.reembolso.cancelacionHecho' : 'avisos.reembolso.cancelacionProceso', { monto, pedido: payload.pedidoId }),
        entidadTipo: 'pedido',
        entidadId: String(payload.pedidoId),
        urlAccion: rutaMiPedido(payload.pedidoId),
        metadata: { monto: payload.monto, reembolso: payload.reembolso },
      },
      'cancelacion',
    );
  }

  /** Reembolso hecho por el personal (pedido o anticipo de cita): aviso a la clienta, uno por reembolso. */
  @OnEvent(EVENTO_REEMBOLSO_REALIZADO)
  async onReembolsoRealizado(payload: ReembolsoRealizadoEvent): Promise<void> {
    if (!payload.usuarioId) return;
    const monto = formatoMonto(payload.monto);
    const esPedido = payload.entidadTipo === 'pedido';
    await this.avisarA(
      payload.usuarioId,
      {
        tipo: 'reembolso',
        titulo: textoSitio('avisos.reembolso.tituloHecho'),
        mensaje: esPedido
          ? textoSitio('avisos.reembolso.pedido', { monto, pedido: payload.entidadId })
          : textoSitio('avisos.reembolso.anticipo', { monto, cita: payload.entidadId }),
        entidadTipo: payload.entidadTipo,
        entidadId: String(payload.entidadId),
        urlAccion: esPedido ? rutaMiPedido(payload.entidadId) : rutaMiCita(payload.entidadId),
        metadata: { monto: payload.monto },
      },
      payload.referencia,
    );
  }

  /** Solicitud ARCO nueva: aviso solo a los admin (quienes la atienden). */
  @OnEvent(EVENTO_ARCO_SOLICITUD_CREADA)
  async onArcoSolicitudCreada(payload: ArcoSolicitudCreadaEvent): Promise<void> {
    await this.avisarPorPermiso(PERMISO_ADMIN, {
      tipo: 'arco_solicitud',
      titulo: textoSitio('avisos.arcoNueva.titulo'),
      mensaje: textoSitio('avisos.arcoNueva.mensaje', { tipoArco: ETIQUETA_TIPO_ARCO[payload.tipo] ?? payload.tipo, folio: payload.folio }),
      entidadTipo: 'solicitud_arco',
      entidadId: String(payload.solicitudId),
      urlAccion: RUTA_SOLICITUDES_ARCO,
    });
  }

  /** Respuesta ARCO: aviso a la titular sin el texto de la respuesta (lo ve en su perfil y en el correo). */
  @OnEvent(EVENTO_ARCO_RESPONDIDA)
  async onArcoRespondida(payload: ArcoRespondidaEvent): Promise<void> {
    await this.avisarA(
      payload.usuarioId,
      {
        tipo: 'arco_respuesta',
        titulo: textoSitio('avisos.arcoRespuesta.titulo'),
        mensaje: textoSitio('avisos.arcoRespuesta.mensaje', { folio: payload.folio, estadoArco: MENSAJE_ESTADO_ARCO[payload.estado] ?? 'cambió de estado' }),
        entidadTipo: 'solicitud_arco',
        entidadId: String(payload.solicitudId),
        urlAccion: RUTA_MIS_SOLICITUDES_ARCO,
      },
      payload.estado,
    );
  }

  /** Anticipo recibido (en línea o en el salón): la clienta sabe que su cita quedó confirmada. */
  @OnEvent('cita.anticipo_pagado')
  async onAnticipoPagado(payload: { citaId: number; clienteId: string | null }): Promise<void> {
    if (!payload.clienteId) return;
    let envioIds: string[] = [];
    const mensaje = await this.textoDeCita('avisos.anticipoRecibido.mensaje', payload.citaId, { cita: payload.citaId });
    try {
      await this.enOutbox(async (tx) => {
        const canales = await this.resolver.resolverCanales(payload.clienteId as string, 'cita_confirmada', ['in_app']);
        const { envios } = await this.outbox.encolar(tx, {
          usuarioId: payload.clienteId as string,
          tipo: 'cita_confirmada',
          titulo: textoSitio('avisos.anticipoRecibido.titulo'),
          mensaje,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
          urlAccion: `/cliente/servicios-citas/mis-citas/${payload.citaId}`,
          canales,
        });
        envioIds = envios.map((e) => e.id);
      });
    } catch (e) {
      this.logger.error(`No se pudo avisar del anticipo pagado de la cita ${payload.citaId}`, e);
      return;
    }
    this.despachador.drenarInmediatas(envioIds);
  }

  @OnEvent('pedido.creado')
  async onPedidoCreado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_creado',
      titulo: textoSitio('avisos.pedidoRecibido.titulo'),
      mensaje: await this.textoDePedido('avisos.pedidoRecibido.mensaje', payload.pedidoId),
    });
  }

  @OnEvent('pedido.pagado')
  async onPedidoPagado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_confirmado',
      titulo: textoSitio('avisos.pedidoConfirmado.titulo'),
      mensaje: await this.textoDePedido('avisos.pedidoConfirmado.mensaje', payload.pedidoId),
    });
  }

  @OnEvent('pedido.listo_recoger')
  async onPedidoListoRecoger(payload: PedidoEvent): Promise<void> {
    // Único aviso de pedidos que también va por email: la clienta tiene que venir al salón.
    await this.notificarPedido(
      payload,
      {
        tipo: 'pedido_listo_recoger',
        titulo: textoSitio('avisos.pedidoListo.titulo'),
        mensaje: await this.textoDePedido('avisos.pedidoListo.mensaje', payload.pedidoId),
      },
      ['in_app', 'email'],
    );
  }

  @OnEvent('pedido.entregado')
  async onPedidoEntregado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_entregado',
      titulo: textoSitio('avisos.pedidoEntregado.titulo'),
      mensaje: await this.textoDePedido('avisos.pedidoEntregado.mensaje', payload.pedidoId),
    });
  }

  @OnEvent('pedido.cancelado')
  async onPedidoCancelado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_cancelado',
      titulo: textoSitio('avisos.pedidoCancelado.titulo'),
      mensaje: await this.textoDePedido('avisos.pedidoCancelado.mensaje', payload.pedidoId),
    });
  }

  /** Encolado común a los eventos de pedidos online: mismo destinatario único
   *  (usuarioId dueño del pedido), misma entidad: cambian tipo/título/mensaje
   *  y, para "listo para recoger", los canales. Igual criterio de fallo que venta_local.pagada: un
   *  error aquí nunca debe afectar el pedido, que ya está comprometido en BD. */
  private async notificarPedido(
    payload: PedidoEvent,
    datos: { tipo: string; titulo: string; mensaje: string },
    canalesDeseados: string[] = ['in_app'],
  ): Promise<void> {
    let envioIds: string[] = [];
    try {
      await this.enOutbox(async (tx) => {
        const canales = await this.resolver.resolverCanales(payload.usuarioId, datos.tipo, canalesDeseados);
        const { envios } = await this.outbox.encolar(tx, {
          usuarioId: payload.usuarioId,
          tipo: datos.tipo,
          titulo: datos.titulo,
          mensaje: datos.mensaje,
          entidadTipo: 'pedido',
          entidadId: String(payload.pedidoId),
          urlAccion: `/cliente/tienda-online/mis-pedidos/${payload.pedidoId}`,
          canales,
        });
        envioIds = envios.map((e) => e.id);
      });
    } catch (e) {
      this.logger.error(
        `No se pudo encolar la notificación '${datos.tipo}' del pedido ${payload.pedidoId} (no afecta el pedido)`,
        e,
      );
      return;
    }

    this.despachador.drenarInmediatas(envioIds);
  }

  /**
   * Plazos de la regla guardada en el pedido al crearlo ({diasPrepararApartado}, {diasCancelarNoRecogido}...), con los
   * mismos nombres que las variables de reglas para que ganen a las de hoy. Si el pedido no se puede leer, los valores
   * por omisión (los que regían antes de guardar reglas en el pedido). Nunca lanza.
   */
  private async variablesDePedido(pedidoId: number): Promise<Record<string, string>> {
    let guardadas: unknown = null;
    try {
      guardadas = (await this.prisma.pedido.findUnique({ where: { id: pedidoId }, select: { reglas: true } }))?.reglas ?? null;
    } catch {
      guardadas = null;
    }
    const r = reglasDePedido(guardadas);
    return {
      plazoPagoLineaHoras: String(r.plazoPagoLineaHoras),
      diasPrepararApartado: String(r.diasPrepararApartado),
      diaRecordatorioRecoger: String(r.diaRecordatorioRecoger),
      diasCancelarNoRecogido: String(r.diasCancelarNoRecogido),
      diasRestantesRecoger: String(r.diasCancelarNoRecogido - r.diaRecordatorioRecoger),
      diasResguardo: String(r.diasResguardoPagado),
      diasCambioProducto: String(r.diasCambioProducto),
      diasHabilesRevocacion: String(r.diasHabilesRevocacion),
    };
  }

  /**
   * Aviso a la clienta sobre su pedido: si el texto usa un plazo ({diasPrepararApartado}, {diasResguardo}...), se lee
   * la regla guardada en el pedido; si no, no se consulta la base.
   */
  private async textoDePedido(clave: string, pedidoId: number): Promise<string> {
    const usaPlazos = variablesDeTexto(plantillaTexto(clave)).some((v) => VARIABLES_DE_PEDIDO.has(v));
    return textoSitio(clave, { pedido: pedidoId, ...(usaPlazos ? await this.variablesDePedido(pedidoId) : {}) });
  }

  /**
   * Aviso a la clienta sobre su cita: si el texto usa un plazo del anticipo ({plazoAnticipoHoras},
   * {diasHabilesCancelarConReembolso}...), se toma la regla guardada en la cita al crearla. Nunca lanza.
   */
  private async textoDeCita(clave: string, citaId: number, contexto: Record<string, string | number>): Promise<string> {
    const usaPlazos = variablesDeTexto(plantillaTexto(clave)).some((v) => VARIABLES_DE_CITA.has(v));
    if (!usaPlazos) return textoSitio(clave, contexto);
    let guardadas: unknown = null;
    try {
      guardadas = (await this.prisma.cita.findUnique({ where: { id: citaId }, select: { reglas: true } }))?.reglas ?? null;
    } catch {
      guardadas = null;
    }
    const r = reglasDeCita(guardadas);
    return textoSitio(clave, {
      plazoAnticipoHoras: String(r.plazoAnticipoHoras),
      minutosAntesPagoSalon: String(r.minutosAntesPagoSalon),
      horasAvisoCancelarReagendar: String(r.horasAvisoCancelarReagendar),
      diasHabilesExcepcionAnticipo: String(r.diasHabilesExcepcionAnticipo),
      diasHabilesCancelarConReembolso: String(r.diasHabilesCancelarConReembolso),
      ...contexto,
    });
  }

  private formatearFecha(fecha: Date): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(fecha);
  }
}
