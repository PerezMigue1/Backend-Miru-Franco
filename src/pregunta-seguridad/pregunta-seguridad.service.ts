import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PreguntaSeguridadService {
  constructor(private prisma: PrismaService) {}

  async obtenerPreguntas() {
    // En Prisma, las preguntas están en la colección de preguntas_seguridad si existe
    // Por ahora, las preguntas están embebidas en los usuarios
    // Este endpoint podría necesitar una colección separada en el futuro
    return {
      success: true,
      message: 'Funcionalidad en desarrollo - Las preguntas están embebidas en usuarios',
      data: [],
      count: 0,
    };
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
    });

    if (!usuario || !usuario.preguntaSeguridad || !(usuario.preguntaSeguridad as any).pregunta) {
      throw new NotFoundException('No existe pregunta para este email');
    }

    const preguntaSeguridad = usuario.preguntaSeguridad as any;
    return {
      success: true,
      data: [
        {
          _id: usuario.id,
          pregunta: preguntaSeguridad.pregunta,
        },
      ],
    };
  }

  async verificarRespuesta(email: string, answers: Record<string, string>) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!usuario || !usuario.preguntaSeguridad || !(usuario.preguntaSeguridad as any).pregunta || !(usuario.preguntaSeguridad as any).respuesta) {
      throw new NotFoundException('No existe pregunta para este email');
    }

    const preguntaSeguridad = usuario.preguntaSeguridad as any;
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

