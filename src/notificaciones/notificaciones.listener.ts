import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';
import { ResolverDestinatariosService } from './resolver-destinatarios.service';
import { DespachadorService } from './despachador.service';

export interface CitaCreadaEvent {
  citaId: number;
  clienteId: string;
  especialistaId: string;
  servicioNombre: string;
  fechaHoraInicio: Date;
}

export interface CitaCanceladaEvent {
  citaId: number;
  clienteId: string;
  especialistaId: string;
  motivo: string;
}

export interface CitaReprogramadaEvent {
  citaId: number;
  clienteId: string;
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
 *  pedido), sin cascada a otros roles — a diferencia de citas, aquí no hay un
 *  segundo actor (especialista) que notificar. */
export interface PedidoEvent {
  pedidoId: number;
  usuarioId: string;
}

/** Tipo usado tanto al programar los 2 recordatorios en `onCitaCreada` como al
 *  identificarlos para descartarlos en la cascada de `onCitaCancelada` —
 *  cambiarlo en un solo lado rompe esa cascada silenciosamente. */
const TIPO_RECORDATORIO_CITA = 'cita_recordatorio';
const RECORDATORIOS_ANTES_MS = [24 * 60 * 60_000, 60 * 60_000]; // 24h, 1h

@Injectable()
export class NotificacionesListener {
  private readonly logger = new Logger(NotificacionesListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly resolver: ResolverDestinatariosService,
    private readonly despachador: DespachadorService,
  ) {}

  @OnEvent('cita.creada')
  async onCitaCreada(payload: CitaCreadaEvent): Promise<void> {
    const fecha = this.formatearFecha(payload.fechaHoraInicio);
    const envioIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      const canalesCliente = await this.resolver.resolverCanales(payload.clienteId, 'cita_creada', ['in_app']);
      const { envios: enviosCliente } = await this.outbox.encolar(tx, {
        usuarioId: payload.clienteId,
        tipo: 'cita_creada',
        titulo: 'Cita agendada',
        mensaje: `Tu cita de ${payload.servicioNombre} quedó agendada para el ${fecha}`,
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        canales: canalesCliente,
      });
      envioIds.push(...enviosCliente.map((e) => e.id));

      const canalesEspecialista = await this.resolver.resolverCanales(payload.especialistaId, 'cita_asignada', [
        'in_app',
      ]);
      const { envios: enviosEspecialista } = await this.outbox.encolar(tx, {
        usuarioId: payload.especialistaId,
        tipo: 'cita_asignada',
        titulo: 'Nueva cita asignada',
        mensaje: `Se te asignó una cita de ${payload.servicioNombre} para el ${fecha}`,
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        canales: canalesEspecialista,
      });
      envioIds.push(...enviosEspecialista.map((e) => e.id));

      // Recordatorios (24h y 1h antes): NO se agregan a `envioIds` — deben
      // quedar 'pendiente' hasta que el barrido (`BarridoService`, cada 5 min)
      // los recoja cuando venza su `programadoPara`. Si se pasaran a
      // `drenarInmediatas` de abajo, `drenar()` los despacharía ahora mismo
      // (no filtra por `programadoPara`), rompiendo el propósito de programarlos.
      const ahora = Date.now();
      for (const antesMs of RECORDATORIOS_ANTES_MS) {
        const programadoPara = new Date(payload.fechaHoraInicio.getTime() - antesMs);
        if (programadoPara.getTime() <= ahora) continue; // la cita se creó con menos antelación que este recordatorio

        const canalesRecordatorio = await this.resolver.resolverCanales(
          payload.clienteId,
          TIPO_RECORDATORIO_CITA,
          ['in_app', 'email'],
        );
        await this.outbox.encolar(tx, {
          usuarioId: payload.clienteId,
          tipo: TIPO_RECORDATORIO_CITA,
          titulo: 'Recordatorio de cita',
          mensaje: `Tu cita de ${payload.servicioNombre} es el ${fecha}`,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
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

    await this.prisma.$transaction(async (tx) => {
      const canalesCliente = await this.resolver.resolverCanales(payload.clienteId, 'cita_cancelada', ['in_app']);
      const { envios: enviosCliente } = await this.outbox.encolar(tx, {
        usuarioId: payload.clienteId,
        tipo: 'cita_cancelada',
        titulo: 'Cita cancelada',
        mensaje: `Tu cita fue cancelada. Motivo: ${payload.motivo}`,
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        canales: canalesCliente,
      });
      envioIds.push(...enviosCliente.map((e) => e.id));

      const canalesEspecialista = await this.resolver.resolverCanales(
        payload.especialistaId,
        'cita_cancelada',
        ['in_app'],
      );
      const { envios: enviosEspecialista } = await this.outbox.encolar(tx, {
        usuarioId: payload.especialistaId,
        tipo: 'cita_cancelada',
        titulo: 'Cita cancelada',
        mensaje: `La cita que tenías asignada fue cancelada. Motivo: ${payload.motivo}`,
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
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

    await this.prisma.$transaction(async (tx) => {
      // (a) Cancelar primero los recordatorios viejos (apuntan a la hora
      // anterior) — debe ir ANTES de programar los nuevos de (c), o este mismo
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

      // (b) Notificación inmediata a cliente + especialista — sí entran a
      // envioIds → drenarInmediatas, deben llegar ya.
      const canalesCliente = await this.resolver.resolverCanales(payload.clienteId, 'cita_reprogramada', ['in_app']);
      const { envios: enviosCliente } = await this.outbox.encolar(tx, {
        usuarioId: payload.clienteId,
        tipo: 'cita_reprogramada',
        titulo: 'Cita reprogramada',
        mensaje: `Tu cita de ${payload.servicioNombre} fue reprogramada para el ${fecha}`,
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        canales: canalesCliente,
      });
      envioIds.push(...enviosCliente.map((e) => e.id));

      const canalesEspecialista = await this.resolver.resolverCanales(
        payload.especialistaId,
        'cita_reprogramada',
        ['in_app'],
      );
      const { envios: enviosEspecialista } = await this.outbox.encolar(tx, {
        usuarioId: payload.especialistaId,
        tipo: 'cita_reprogramada',
        titulo: 'Cita reprogramada',
        mensaje: `La cita de ${payload.servicioNombre} que tenías asignada fue reprogramada para el ${fecha}`,
        entidadTipo: 'cita',
        entidadId: String(payload.citaId),
        canales: canalesEspecialista,
      });
      envioIds.push(...enviosEspecialista.map((e) => e.id));

      // (c) Recordatorios nuevos con la fecha nueva — mismo guard de
      // antelación que onCitaCreada, y mismo cuidado: NO entran a envioIds.
      const ahora = Date.now();
      for (const antesMs of RECORDATORIOS_ANTES_MS) {
        const programadoPara = new Date(payload.fechaHoraInicioNueva.getTime() - antesMs);
        if (programadoPara.getTime() <= ahora) continue;

        const canalesRecordatorio = await this.resolver.resolverCanales(
          payload.clienteId,
          TIPO_RECORDATORIO_CITA,
          ['in_app', 'email'],
        );
        await this.outbox.encolar(tx, {
          usuarioId: payload.clienteId,
          tipo: TIPO_RECORDATORIO_CITA,
          titulo: 'Recordatorio de cita',
          mensaje: `Tu cita de ${payload.servicioNombre} es el ${fecha}`,
          entidadTipo: 'cita',
          entidadId: String(payload.citaId),
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

      await this.prisma.$transaction(async (tx) => {
        const canales = await this.resolver.resolverCanales(payload.clienteId, 'venta', ['in_app']);
        const { envios } = await this.outbox.encolar(tx, {
          usuarioId: payload.clienteId,
          tipo: 'venta',
          titulo: 'Tu ticket de compra',
          mensaje: `Folio ${payload.folio} · Total ${totalFmt} · ${fecha}`,
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

  @OnEvent('pedido.creado')
  async onPedidoCreado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_creado',
      titulo: 'Pedido recibido',
      mensaje: `Recibimos tu pedido #${payload.pedidoId}, pendiente de pago`,
    });
  }

  @OnEvent('pedido.pagado')
  async onPedidoPagado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_confirmado',
      titulo: 'Pedido confirmado',
      mensaje: `Tu pedido #${payload.pedidoId} fue confirmado — pago recibido`,
    });
  }

  @OnEvent('pedido.listo_recoger')
  async onPedidoListoRecoger(payload: PedidoEvent): Promise<void> {
    // Único aviso de pedidos que también va por email: la clienta tiene que venir al salón.
    await this.notificarPedido(
      payload,
      {
        tipo: 'pedido_listo_recoger',
        titulo: 'Tu pedido está listo para recoger',
        mensaje: `Tu pedido #${payload.pedidoId} está listo para recoger en el salón`,
      },
      ['in_app', 'email'],
    );
  }

  @OnEvent('pedido.entregado')
  async onPedidoEntregado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_entregado',
      titulo: 'Pedido entregado en el salón',
      mensaje: `Tu pedido #${payload.pedidoId} fue entregado en el salón`,
    });
  }

  @OnEvent('pedido.cancelado')
  async onPedidoCancelado(payload: PedidoEvent): Promise<void> {
    await this.notificarPedido(payload, {
      tipo: 'pedido_cancelado',
      titulo: 'Pedido cancelado',
      mensaje: `Tu pedido #${payload.pedidoId} fue cancelado`,
    });
  }

  /** Encolado común a los eventos de pedidos online: mismo destinatario único
   *  (usuarioId dueño del pedido), misma entidad — cambian tipo/título/mensaje
   *  y, para "listo para recoger", los canales. Igual criterio de fallo que venta_local.pagada: un
   *  error aquí nunca debe afectar el pedido, que ya está comprometido en BD. */
  private async notificarPedido(
    payload: PedidoEvent,
    datos: { tipo: string; titulo: string; mensaje: string },
    canalesDeseados: string[] = ['in_app'],
  ): Promise<void> {
    let envioIds: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
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

  private formatearFecha(fecha: Date): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(fecha);
  }
}
