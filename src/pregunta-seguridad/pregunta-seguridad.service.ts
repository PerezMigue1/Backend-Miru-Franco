import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PreguntaSeguridadService {
  constructor(private prisma: PrismaService) {}

  async obtenerPreguntas() {
    // Preguntas predefinidas hardcodeadas (fallback si la base de datos falla)
    const preguntasPredefinidas = [
      { id: 'pregunta-1', pregunta: '¿Cuál es el nombre de tu mascota favorita?' },
      { id: 'pregunta-2', pregunta: '¿En qué ciudad naciste?' },
      { id: 'pregunta-3', pregunta: '¿Cuál es el nombre de tu mejor amigo de la infancia?' },
      { id: 'pregunta-4', pregunta: '¿Cuál es el nombre de tu primera escuela?' },
      { id: 'pregunta-5', pregunta: '¿Cuál es el apellido de soltera de tu madre?' },
      { id: 'pregunta-6', pregunta: '¿Cuál es tu comida favorita?' },
      { id: 'pregunta-7', pregunta: '¿Cuál es el nombre de tu película favorita?' },
      { id: 'pregunta-8', pregunta: '¿En qué calle creciste?' },
    ];

    try {
      // Consultar todas las preguntas DISPONIBLES (preguntas predefinidas, no las de usuarios)
      const preguntasDisponibles = await this.prisma.preguntaDisponible.findMany({
        where: {
          activa: true,
        },
        select: {
          id: true,
          pregunta: true,
        },
        orderBy: {
          pregunta: 'asc',
        },
      });

      // Si hay preguntas en la base de datos, usarlas
      if (preguntasDisponibles.length > 0) {
        const preguntas = preguntasDisponibles.map((p) => ({
          id: p.id,
          pregunta: p.pregunta,
        }));

        return {
          success: true,
          message: 'Preguntas de seguridad disponibles',
          data: preguntas,
          count: preguntas.length,
        };
      }

      // Si no hay preguntas en la base de datos, devolver preguntas predefinidas hardcodeadas
      console.log('⚠️ No hay preguntas en la base de datos, usando preguntas hardcodeadas');
      return {
        success: true,
        message: 'Preguntas de seguridad disponibles',
        data: preguntasPredefinidas,
        count: preguntasPredefinidas.length,
      };
    } catch (error: any) {
      // Si hay error (tabla no existe, Prisma no regenerado, etc.), devolver preguntas hardcodeadas
      console.error('⚠️ Error obteniendo preguntas de seguridad de la BD:', error.message);
      console.log('✅ Usando preguntas predefinidas hardcodeadas como fallback');
      
      return {
        success: true,
        message: 'Preguntas de seguridad disponibles',
        data: preguntasPredefinidas,
        count: preguntasPredefinidas.length,
      };
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
    console.log('🔍 Obteniendo pregunta por email:', email);
    
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        googleId: true,
        preguntaSeguridad: true,
      },
    });

    if (!usuario) {
      console.error('❌ Usuario no encontrado para email:', email);
      throw new NotFoundException('No existe pregunta para este email');
    }

    // Si es un usuario de Google y no tiene pregunta de seguridad
    if (usuario.googleId && !usuario.preguntaSeguridad) {
      console.log('⚠️ Usuario de Google sin pregunta de seguridad:', email);
      throw new NotFoundException('Este correo está asociado a una cuenta de Google. No se puede usar recuperación de contraseña por pregunta de seguridad.');
    }

    if (!usuario.preguntaSeguridad) {
      console.error('❌ Usuario sin pregunta de seguridad:', email);
      throw new NotFoundException('No existe pregunta para este email. Este correo puede estar asociado a una cuenta de Google.');
    }

    console.log('✅ Pregunta de seguridad encontrada:', usuario.preguntaSeguridad);

    return {
      success: true,
      data: [
        {
          _id: usuario.id,
          pregunta: usuario.preguntaSeguridad,
        },
      ],
    };
  }

  async verificarRespuesta(email: string, answers: Record<string, string>) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        preguntaSeguridad: true,
        respuestaSeguridad: true,
      },
    });

    if (!usuario || !usuario.preguntaSeguridad || !usuario.respuestaSeguridad) {
      throw new NotFoundException('No existe pregunta para este email');
    }

    const keys = Object.keys(answers);
    
    if (keys.length === 0) {
      throw new BadRequestException('answers vacío');
    }

    const preguntaTexto = keys[0];
    const respuestaPlano = String(answers[preguntaTexto] ?? '').trim();
    
    if (!respuestaPlano) {
      throw new BadRequestException('Respuesta vacía');
    }

    if (preguntaTexto !== usuario.preguntaSeguridad) {
      throw new BadRequestException('Pregunta no coincide');
    }

    const ok = await bcrypt.compare(respuestaPlano, usuario.respuestaSeguridad);
    if (!ok) {
      throw new BadRequestException('Respuesta incorrecta');
    }

    return { success: true };
  }
}

