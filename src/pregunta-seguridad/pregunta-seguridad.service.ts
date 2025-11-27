import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PreguntaSeguridadService {
  constructor(private prisma: PrismaService) {}

  async obtenerPreguntas() {
    try {
      // Consultar todas las preguntas de seguridad usando la relación
      const preguntasSeguridad = await this.prisma.preguntaSeguridad.findMany({
        select: {
          id: true,
          pregunta: true,
        },
        distinct: ['pregunta'],
      });

      // Convertir a formato esperado por el frontend
      const preguntas = preguntasSeguridad.map((ps, index) => ({
        id: ps.id || `pregunta-${index + 1}`,
        pregunta: ps.pregunta,
      }));

      return {
        success: true,
        message: preguntas.length > 0 
          ? 'Preguntas de seguridad disponibles' 
          : 'No hay preguntas de seguridad disponibles en la base de datos',
        data: preguntas,
        count: preguntas.length,
      };
    } catch (error) {
      console.error('Error obteniendo preguntas de seguridad:', error);
      throw new NotFoundException('Error al obtener las preguntas de seguridad');
    }
  }

  async obtenerPorId(id: string) {
    // Implementar si se necesita una colección separada
    throw new NotFoundException('Pregunta no encontrada');
  }

  async crearPregunta(pregunta: string, email?: string, respuesta?: string) {
    // Si respuesta existe, debe ser hasheada
    let respuestaHasheada: string | undefined;
    if (respuesta) {
      respuestaHasheada = await bcrypt.hash(respuesta.trim(), 10);
    }

    return {
      success: true,
      message: 'Las preguntas se crean al registrar usuarios',
      data: {
        pregunta,
        email,
        respuesta: respuestaHasheada ? '[hasheada]' : undefined,
      },
    };
  }

  async actualizarPregunta(id: string, updateData: any) {
    // Implementar si se necesita
    throw new BadRequestException('Funcionalidad en desarrollo');
  }

  async eliminarPregunta(id: string) {
    // Implementar si se necesita
    throw new BadRequestException('Funcionalidad en desarrollo');
  }

  async obtenerPreguntaPorEmail(email: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      include: { preguntaSeguridad: true },
    });

    if (!usuario || !usuario.preguntaSeguridad || !usuario.preguntaSeguridad.pregunta) {
      throw new NotFoundException('No existe pregunta para este email');
    }

    return {
      success: true,
      data: [
        {
          _id: usuario.id,
          pregunta: usuario.preguntaSeguridad.pregunta,
        },
      ],
    };
  }

  async verificarRespuesta(email: string, answers: Record<string, string>) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      include: { preguntaSeguridad: true },
    });

    if (!usuario || !usuario.preguntaSeguridad || !usuario.preguntaSeguridad.pregunta || !usuario.preguntaSeguridad.respuesta) {
      throw new NotFoundException('No existe pregunta para este email');
    }

    const preguntaSeguridad = usuario.preguntaSeguridad;
    const keys = Object.keys(answers);
    
    if (keys.length === 0) {
      throw new BadRequestException('answers vacío');
    }

    const preguntaTexto = keys[0];
    const respuestaPlano = String(answers[preguntaTexto] ?? '').trim();
    
    if (!respuestaPlano) {
      throw new BadRequestException('Respuesta vacía');
    }

    if (preguntaTexto !== preguntaSeguridad.pregunta) {
      throw new BadRequestException('Pregunta no coincide');
    }

    const ok = await bcrypt.compare(respuestaPlano, preguntaSeguridad.respuesta);
    if (!ok) {
      throw new BadRequestException('Respuesta incorrecta');
    }

    return { success: true };
  }
}

