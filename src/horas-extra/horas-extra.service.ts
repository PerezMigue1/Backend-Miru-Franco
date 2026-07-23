import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ZONA_SALON = 'America/Mexico_City';
const ID_CONFIG = 1;

export interface ResumenEmpleado {
  usuarioId: string;
  nombre: string;
  minutosExtraTotal: number;
  horasExtra: string;
  tarifaConfigurada: boolean;
  montoTotal: number;
  registrosCerradosAutomaticos: number;
  registrosSinHorarioEsperado: number;
}

/** "YYYY-MM" del mes actual en hora de México — mismo criterio que "hoy" en la Fase 2. */
function mesActualMexico(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_SALON }).slice(0, 7);
}

/** Día de semana de una fecha "YYYY-MM-DD" sin tocar timezone del servidor: 0=domingo … 6=sábado. */
function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El instante real (offset fijo -06:00, México) de una hora "HH:mm" en el día `fecha`. */
function instanteEnFecha(fecha: string, horaHHmm: string): Date {
  return new Date(`${fecha}T${horaHHmm}:00-06:00`);
}

function formatearHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${m}m`;
}

function redondearMoneda(v: number): number {
  return Math.round(v * 100) / 100;
}

@Injectable()
export class HorasExtraService {
  constructor(private readonly prisma: PrismaService) {}

  private async calcularParaUsuarios(mes: string, usuarioId?: string) {
    const config = await this.prisma.configuracionSalon.upsert({
      where: { id: ID_CONFIG },
      update: {},
      create: {
        id: ID_CONFIG,
        entradaLunesViernes: '09:00',
        salidaLunesViernes: '18:00',
        entradaSabado: '09:00',
        salidaSabado: '18:00',
        tarifaHoraExtra: 0,
      },
    });
    const tarifaConfigurada = Number(config.tarifaHoraExtra) > 0;

    const registros = await this.prisma.registroAsistencia.findMany({
      where: {
        fecha: { startsWith: mes },
        horaSalida: { not: null },
        ...(usuarioId ? { usuarioId } : {}),
      },
      include: { usuario: { select: { id: true, nombre: true } } },
    });

    const porUsuario = new Map<string, ResumenEmpleado>();

    for (const r of registros) {
      const nombre = r.usuario?.nombre ?? 'Empleado';
      let resumen = porUsuario.get(r.usuarioId);
      if (!resumen) {
        resumen = {
          usuarioId: r.usuarioId,
          nombre,
          minutosExtraTotal: 0,
          horasExtra: '0h 0m',
          tarifaConfigurada,
          montoTotal: 0,
          registrosCerradosAutomaticos: 0,
          registrosSinHorarioEsperado: 0,
        };
        porUsuario.set(r.usuarioId, resumen);
      }

      if (r.cerradoAutomatico) {
        resumen.registrosCerradosAutomaticos += 1;
        continue;
      }

      const dia = diaSemana(r.fecha);
      const horaEsperadaHHmm =
        dia === 0 ? config.salidaDomingo : dia === 6 ? config.salidaSabado : config.salidaLunesViernes;

      // Domingo sin horario configurado (config.salidaDomingo === null): no se inventa un
      // horario esperado, se excluye del cálculo y se cuenta aparte del cierre automático.
      if (!horaEsperadaHHmm) {
        resumen.registrosSinHorarioEsperado += 1;
        continue;
      }

      const esperada = instanteEnFecha(r.fecha, horaEsperadaHHmm);
      const umbral = new Date(esperada.getTime() + config.margenGraciaMinutos * 60_000);
      const salidaReal = r.horaSalida as Date;

      if (salidaReal > umbral) {
        const extraMin = Math.round((salidaReal.getTime() - esperada.getTime()) / 60_000);
        resumen.minutosExtraTotal += extraMin;
      }
    }

    for (const resumen of porUsuario.values()) {
      resumen.horasExtra = formatearHoras(resumen.minutosExtraTotal);
      resumen.montoTotal = redondearMoneda((resumen.minutosExtraTotal / 60) * Number(config.tarifaHoraExtra));
    }

    return { config, tarifaConfigurada, resumenes: Array.from(porUsuario.values()) };
  }

  async listar(mesParam?: string) {
    const mes = mesParam || mesActualMexico();
    const { resumenes } = await this.calcularParaUsuarios(mes);

    const totalGeneral = resumenes.reduce(
      (acc, r) => ({
        minutosExtraTotal: acc.minutosExtraTotal + r.minutosExtraTotal,
        montoTotal: redondearMoneda(acc.montoTotal + r.montoTotal),
      }),
      { minutosExtraTotal: 0, montoTotal: 0 },
    );

    return {
      success: true,
      mes,
      data: resumenes,
      totalGeneral: {
        minutosExtraTotal: totalGeneral.minutosExtraTotal,
        horasExtra: formatearHoras(totalGeneral.minutosExtraTotal),
        montoTotal: totalGeneral.montoTotal,
      },
    };
  }

  async mias(usuarioId: string, mesParam?: string) {
    const mes = mesParam || mesActualMexico();
    const { resumenes, tarifaConfigurada } = await this.calcularParaUsuarios(mes, usuarioId);
    const propio = resumenes[0] ?? {
      usuarioId,
      nombre: '',
      minutosExtraTotal: 0,
      horasExtra: '0h 0m',
      tarifaConfigurada,
      montoTotal: 0,
      registrosCerradosAutomaticos: 0,
      registrosSinHorarioEsperado: 0,
    };

    return { success: true, mes, data: propio };
  }
}
