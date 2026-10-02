import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { DATOS_NO_COINCIDEN, SIN_PREGUNTA_RECUPERACION } from '../usuarios/usuarios.service';

@Injectable()
export class PreguntaSeguridadService {
  // Sin correo ni pregunta en los logs.
  private readonly logger = new Logger(PreguntaSeguridadService.name);

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

  async obtenerPorId(_id: string) {
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

  async actualizarPregunta(_id: string, _updateData: any) {
    throw new BadRequestException('Funcionalidad en desarrollo');
  }

  async eliminarPregunta(_id: string) {
    throw new BadRequestException('Funcionalidad en desarrollo');
  }

  /**
   * Equivale a POST /api/auth/pregunta-seguridad: inexistente, inactivo, de Google o sin pregunta
   * responden el mismo 400 con el mismo texto, para no revelar si el correo existe.
   */
  async obtenerPreguntaPorEmail(email: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        activo: true,
        preguntaSeguridad: true,
      },
    });

    if (!usuario || !usuario.activo || !usuario.preguntaSeguridad) {
      throw new BadRequestException(SIN_PREGUNTA_RECUPERACION);
    }

    this.logger.log(`Pregunta de seguridad encontrada (${usuario.id})`);

    return {
      success: true,
      data: [
        {
          id: usuario.id,
          pregunta: usuario.preguntaSeguridad,
        },
      ],
    };
  }

  /**
   * Equivale a POST /api/auth/verificar-respuesta: cualquier fallo que dependa de la cuenta
   * (inexistente, inactiva, sin pregunta, pregunta o respuesta distinta) es el mismo 400.
   * Los errores de forma de `answers` se validan antes de consultar, así no dependen de la cuenta.
   */
  async verificarRespuesta(email: string, answers: Record<string, string>) {
    const keys = Object.keys(answers);

    if (keys.length === 0) {
      throw new BadRequestException('answers vacío');
    }

    const preguntaTexto = keys[0];
    const respuestaPlano = String(answers[preguntaTexto] ?? '').trim();

    if (!respuestaPlano) {
      throw new BadRequestException('Respuesta vacía');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        activo: true,
        preguntaSeguridad: true,
        respuestaSeguridad: true,
      },
    });

    if (
      !usuario ||
      !usuario.activo ||
      !usuario.preguntaSeguridad ||
      !usuario.respuestaSeguridad ||
      preguntaTexto !== usuario.preguntaSeguridad
    ) {
      throw new BadRequestException(DATOS_NO_COINCIDEN);
    }

    const ok = await bcrypt.compare(respuestaPlano, usuario.respuestaSeguridad);
    if (!ok) {
      throw new BadRequestException(DATOS_NO_COINCIDEN);
    }

    return { success: true };
  }
}

