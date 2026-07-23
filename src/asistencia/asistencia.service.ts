import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CorregirAsistenciaDto } from './dto/corregir-asistencia.dto';

const ZONA_SALON = 'America/Mexico_City';

/** "YYYY-MM-DD" del día calendario actual en hora de México — nunca UTC del servidor. */
function fechaHoyMexico(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_SALON });
}

/**
 * Instante de corte para el cierre perezoso: las 02:00 AM (hora de México, offset fijo
 * -06:00 — sin DST desde 2022) del día SIGUIENTE a `fecha`. Se usa como `horaSalida`
 * de un registro que quedó abierto de un día anterior.
 */
function corteDosAM(fecha: string): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  const siguienteUTC = new Date(Date.UTC(y, m - 1, d + 1));
  const siguienteStr = siguienteUTC.toISOString().slice(0, 10);
  return new Date(`${siguienteStr}T02:00:00-06:00`);
}

@Injectable()
export class AsistenciaService {
  constructor(private readonly prisma: PrismaService) {}

  private incluirRelaciones() {
    return {
      usuario: { select: { id: true, nombre: true, email: true } },
      corregidoPor: { select: { id: true, nombre: true } },
    } as const;
  }

  /**
   * Cierre perezoso: cualquier registro sin `horaSalida` de un día anterior a hoy se
   * cierra con la hora de corte de las 02:00 AM. Sin cron — se corre al leer o marcar.
   */
  private async cerrarRegistrosVencidos(usuarioId?: string) {
    const hoy = fechaHoyMexico();
    const abiertos = await this.prisma.registroAsistencia.findMany({
      where: {
        horaSalida: null,
        fecha: { lt: hoy },
        ...(usuarioId ? { usuarioId } : {}),
      },
    });

    for (const registro of abiertos) {
      await this.prisma.registroAsistencia.update({
        where: { id: registro.id },
        data: { horaSalida: corteDosAM(registro.fecha), cerradoAutomatico: true },
      });
    }
  }

  /**
   * Sin body: la diferencia entre "entrada" y "salida" sale del estado real del
   * registro del día, nunca de un parámetro que el cliente pudiera falsear.
   */
  async marcar(usuarioId: string) {
    await this.cerrarRegistrosVencidos(usuarioId);

    const hoy = fechaHoyMexico();
    const registroHoy = await this.prisma.registroAsistencia.findUnique({
      where: { usuarioId_fecha: { usuarioId, fecha: hoy } },
    });

    if (!registroHoy) {
      const creado = await this.prisma.registroAsistencia.create({
        data: { usuarioId, fecha: hoy, horaEntrada: new Date() },
        include: this.incluirRelaciones(),
      });
      return { success: true, message: 'Entrada registrada', data: creado };
    }

    if (registroHoy.horaSalida === null) {
      const actualizado = await this.prisma.registroAsistencia.update({
        where: { id: registroHoy.id },
        data: { horaSalida: new Date() },
        include: this.incluirRelaciones(),
      });
      return { success: true, message: 'Salida registrada', data: actualizado };
    }

    throw new BadRequestException('Ya registraste tu jornada de hoy');
  }

  async listarMias(usuarioId: string) {
    await this.cerrarRegistrosVencidos(usuarioId);
    const data = await this.prisma.registroAsistencia.findMany({
      where: { usuarioId },
      include: this.incluirRelaciones(),
      orderBy: { fecha: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async listar() {
    await this.cerrarRegistrosVencidos();
    const data = await this.prisma.registroAsistencia.findMany({
      include: this.incluirRelaciones(),
      orderBy: { fecha: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async corregir(id: number, corregidoPorId: string, dto: CorregirAsistenciaDto) {
    const existe = await this.prisma.registroAsistencia.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Registro de asistencia no encontrado');
    }

    const horaEntradaFinal = dto.horaEntrada ? new Date(dto.horaEntrada) : existe.horaEntrada;
    const horaSalidaFinal = dto.horaSalida !== undefined ? new Date(dto.horaSalida) : existe.horaSalida;
    if (horaSalidaFinal && horaSalidaFinal < horaEntradaFinal) {
      throw new BadRequestException('La hora de salida no puede ser anterior a la hora de entrada');
    }

    const registro = await this.prisma.registroAsistencia.update({
      where: { id },
      data: {
        ...(dto.horaEntrada !== undefined && { horaEntrada: new Date(dto.horaEntrada) }),
        // Si la jefa/admin fija la salida a mano, deja de ser un cierre automático.
        ...(dto.horaSalida !== undefined && { horaSalida: new Date(dto.horaSalida), cerradoAutomatico: false }),
        corregidoPorId,
      },
      include: this.incluirRelaciones(),
    });

    console.log('✅ Asistencia corregida:', JSON.stringify({ id, corregidoPorId }));

    return { success: true, message: 'Registro corregido correctamente', data: registro };
  }
}
