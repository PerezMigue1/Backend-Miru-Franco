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

export interface VentaLocalPagadaEvent {
  ventaId: number;
  clienteId: string;
  folio: string;
  total: number;
  creadoEn: Date;
}

/**
 * Placeholder del tipo que usarán los recordatorios cuando exista su
 * productor (barrido/scheduler de una etapa futura). No hay ningún código hoy
 * que cree notificaciones con este tipo — la cascada de cancelación de abajo
 * queda como no-op hasta entonces. Nombre asumido, no verificado contra
 * ninguna especificación existente: avisar si el nombre real debe ser otro.
 */
const TIPO_RECORDATORIO_CITA = 'cita_recordatorio';

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

  private formatearFecha(fecha: Date): string {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(fecha);
  }
}
