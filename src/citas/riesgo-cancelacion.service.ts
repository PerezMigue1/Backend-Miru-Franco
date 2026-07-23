import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ModeloCancelacionService,
  RegistroModeloCancelacion,
  ResultadoModeloCancelacion,
} from './modelo-cancelacion.service';

const MILISEGUNDOS_DIA = 86_400_000;
const ZONA_HORARIA = 'America/Mexico_City';
const ESTADOS_HISTORICOS = ['cancelada', 'completada'] as const;

interface ComponentesFecha {
  diaSemana: string;
  hora: number;
  mes: number;
  esFinSemana: number;
  franjaHoraria: 'manana' | 'tarde' | 'noche';
}

export interface RiesgoCancelacionCita extends ResultadoModeloCancelacion {
  citaId: number;
  calculadoEn: string;
}

@Injectable()
export class RiesgoCancelacionService {
  private readonly formatoFecha = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA_HORARIA,
    weekday: 'long',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelo: ModeloCancelacionService,
  ) {}

  private normalizarTexto(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private componentesFecha(fecha: Date): ComponentesFecha {
    const partes = this.formatoFecha.formatToParts(fecha);
    const obtener = (tipo: Intl.DateTimeFormatPartTypes) =>
      partes.find((parte) => parte.type === tipo)?.value ?? '';

    const diaSemana = this.normalizarTexto(obtener('weekday'));
    const horaEntera = Number(obtener('hour'));
    const minutos = Number(obtener('minute'));
    const hora = horaEntera + minutos / 60;
    const mes = Number(obtener('month'));
    const esFinSemana = ['sabado', 'domingo'].includes(diaSemana) ? 1 : 0;
    const franjaHoraria = hora < 12 ? 'manana' : hora < 17 ? 'tarde' : 'noche';

    return { diaSemana, hora, mes, esFinSemana, franjaHoraria };
  }

  async predecirLote(citaIds: number[]): Promise<RiesgoCancelacionCita[]> {
    const idsUnicos = [...new Set(citaIds)];
    const citas = await this.prisma.cita.findMany({
      where: { id: { in: idsUnicos } },
      include: {
        cliente: { select: { creadoEn: true } },
        servicio: {
          select: {
            id: true,
            categoria: true,
            precio: true,
            duracionMinutos: true,
            requiereEvaluacion: true,
          },
        },
      },
    });
    if (citas.length === 0) return [];

    const clientes = [...new Set(citas.map((cita) => cita.clienteId))];
    const fechaCorteMaxima = new Date(
      Math.max(...citas.map((cita) => cita.creadoEn.getTime())),
    );
    const historicos = await this.prisma.cita.findMany({
      where: {
        clienteId: { in: clientes },
        estado: { in: [...ESTADOS_HISTORICOS] },
        fechaHoraFin: { lt: fechaCorteMaxima },
      },
      select: {
        id: true,
        clienteId: true,
        estado: true,
        fechaHoraFin: true,
      },
    });

    const porId = new Map(citas.map((cita) => [cita.id, cita]));
    const calculadoEn = new Date().toISOString();
    const resultados: RiesgoCancelacionCita[] = [];

    // Respeta el orden pedido por el frontend.
    for (const citaId of idsUnicos) {
      const cita = porId.get(citaId);
      if (!cita) continue;

      const historialDisponible = historicos.filter(
        (previa) =>
          previa.id !== cita.id &&
          previa.clienteId === cita.clienteId &&
          previa.fechaHoraFin < cita.creadoEn,
      );
      const cancelacionesPrevias = historialDisponible.filter(
        (previa) => previa.estado === 'cancelada',
      ).length;
      const completadasPrevias = historialDisponible.filter(
        (previa) => previa.estado === 'completada',
      ).length;
      const citasPrevias = cancelacionesPrevias + completadasPrevias;
      const componentes = this.componentesFecha(cita.fechaHoraInicio);

      const registro: RegistroModeloCancelacion = {
        dias_anticipacion: Math.max(
          0,
          (cita.fechaHoraInicio.getTime() - cita.creadoEn.getTime()) /
            MILISEGUNDOS_DIA,
        ),
        hora_cita: componentes.hora,
        mes_cita: componentes.mes,
        es_fin_semana: componentes.esFinSemana,
        citas_previas_cliente: citasPrevias,
        cancelaciones_previas_cliente: cancelacionesPrevias,
        completadas_previas_cliente: completadasPrevias,
        tasa_cancelacion_cliente:
          citasPrevias > 0 ? cancelacionesPrevias / citasPrevias : 0,
        cliente_nuevo: citasPrevias === 0 ? 1 : 0,
        antiguedad_cliente_dias: Math.max(
          0,
          Math.floor(
            (cita.creadoEn.getTime() - cita.cliente.creadoEn.getTime()) /
              MILISEGUNDOS_DIA,
          ),
        ),
        precio_servicio: Number(cita.servicio.precio),
        duracion_servicio: cita.servicio.duracionMinutos,
        requiere_evaluacion: cita.servicio.requiereEvaluacion ? 1 : 0,
        dia_semana: componentes.diaSemana,
        franja_horaria: componentes.franjaHoraria,
        servicio_id: String(cita.servicio.id),
        categoria_servicio: cita.servicio.categoria,
        especialista_id: cita.especialistaId,
      };

      resultados.push({
        citaId,
        calculadoEn,
        ...this.modelo.predecir(registro),
      });
    }

    return resultados;
  }
}
