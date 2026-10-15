import { Injectable, NotFoundException, BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { DATOS_NO_COINCIDEN, SIN_PREGUNTA_RECUPERACION, esRespuestaPorDefinir } from '../usuarios/usuarios.service';
import { sanitizeInput, containsSQLInjection, escaparHtml } from '../common/utils/security.util';
import { EmailService } from '../email/email.service';
import { fechaHoraMexico } from '../usuarios/cambio-password';

// 400 y no 401: la web y la app tratan el 401 como sesión vencida y la cierran.
export const CUENTA_GOOGLE_SIN_PREGUNTA = 'Tu cuenta entra con Google y no usa pregunta de seguridad.';
export const PASSWORD_ACTUAL_REQUERIDA_PREGUNTA = 'Escribe tu contraseña actual para cambiar la pregunta de seguridad.';
export const PASSWORD_ACTUAL_INCORRECTA = 'La contraseña actual no es correcta.';

@Injectable()
export class PreguntaSeguridadService {
  // Sin correo ni pregunta en los logs.
  private readonly logger = new Logger(PreguntaSeguridadService.name);

  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Reautenticación para cambiar la pregunta de seguridad (factor de recuperación) o su catálogo: con una sesión
   * robada no basta. Las cuentas solo de Google no tienen contraseña ni usan pregunta: se rechazan.
   */
  private async verificarPasswordActual(usuarioId: string | undefined, passwordActual: unknown) {
    if (!usuarioId) {
      throw new UnauthorizedException('Sesión inválida');
    }
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, email: true, password: true },
    });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (!usuario.password) {
      throw new BadRequestException({ message: CUENTA_GOOGLE_SIN_PREGUNTA, code: 'CUENTA_GOOGLE_SIN_PREGUNTA' });
    }
    if (typeof passwordActual !== 'string' || !passwordActual) {
      throw new BadRequestException({ message: PASSWORD_ACTUAL_REQUERIDA_PREGUNTA, code: 'PASSWORD_ACTUAL_REQUERIDA' });
    }
    if (!(await bcrypt.compare(passwordActual, usuario.password))) {
      throw new BadRequestException({ message: PASSWORD_ACTUAL_INCORRECTA, code: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    return { id: usuario.id, email: usuario.email };
  }

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

  /**
   * POST /pregunta-seguridad: establece o actualiza la pregunta y respuesta de recuperación del
   * usuario autenticado, con su contraseña actual. Mismo criterio que usuarios.service al registrar:
   * sanitizar, rechazar "Por definir" y guardar la respuesta hasheada con bcrypt (nunca en claro).
   * Conserva el contrato de la respuesta anterior: { success, message, data: { pregunta, email, respuesta } }.
   * Avisa por correo a la cuenta; si el aviso falla, el cambio se mantiene.
   */
  async crearPregunta(usuarioId: string | undefined, pregunta: string, respuesta?: string, passwordActual?: string) {
    const usuario = await this.verificarPasswordActual(usuarioId, passwordActual);
    const preguntaLimpia = sanitizeInput(String(pregunta ?? ''));
    const respuestaPlana = sanitizeInput(String(respuesta ?? ''));
    if (!preguntaLimpia) {
      throw new BadRequestException('La pregunta de seguridad es obligatoria');
    }
    if (!respuestaPlana) {
      throw new BadRequestException('La respuesta de seguridad es obligatoria');
    }
    // "Por definir" (la respuesta por defecto de la pantalla de admin) sigue bloqueada.
    if (esRespuestaPorDefinir(respuestaPlana)) {
      throw new BadRequestException('"Por definir" no es una respuesta de seguridad válida');
    }
    if (containsSQLInjection(preguntaLimpia) || containsSQLInjection(respuestaPlana)) {
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    const respuestaHasheada = await bcrypt.hash(respuestaPlana, 10);
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        preguntaSeguridad: preguntaLimpia,
        respuestaSeguridad: respuestaHasheada,
      },
    });
    // Sin pregunta ni respuesta en el log: solo el id.
    this.logger.log(`Pregunta de seguridad guardada (${usuario.id})`);
    await this.avisarCambioPregunta(usuario);

    return {
      success: true,
      message: 'Las preguntas se crean al registrar usuarios',
      data: {
        pregunta: preguntaLimpia,
        email: usuario.email,
        respuesta: '[hasheada]',
      },
    };
  }

  /** Aviso a la cuenta de que su pregunta cambió (sin la pregunta ni la respuesta). El log no lleva el correo. */
  private async avisarCambioPregunta(usuario: { id: string; email: string }) {
    try {
      await this.emailService.sendNotificationEmail(
        usuario.email,
        'Tu pregunta de seguridad cambió - Miru Franco',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">Tu pregunta de seguridad cambió</h2>
            <p>La pregunta de seguridad de tu cuenta de Miru Franco se cambió el ${escaparHtml(fechaHoraMexico(new Date()))} (hora del centro de México).</p>
            <p style="color: #666;">Si no fuiste tú, cambia tu contraseña desde tu perfil y comunícate con el salón lo antes posible.</p>
          </div>
        `,
      );
    } catch {
      this.logger.warn(`No se pudo enviar el aviso de cambio de pregunta de seguridad (${usuario.id})`);
    }
  }

  /**
   * PUT /pregunta-seguridad/:id (solo admin): gestión del catálogo preguntas_disponibles.
   * Si el id existe, renombra (pregunta) y/o activa/desactiva (activa); si no existe, crea la
   * pregunta con ese id (PUT idempotente), exigiendo el texto. Pide la contraseña actual de quien hace el cambio.
   */
  async actualizarPregunta(
    id: string,
    updateData: { pregunta?: string; activa?: boolean; passwordActual?: string },
    usuarioId: string | undefined,
  ) {
    await this.verificarPasswordActual(usuarioId, updateData?.passwordActual);
    const idLimpio = sanitizeInput(String(id ?? ''));
    if (!idLimpio) {
      throw new BadRequestException('El id de la pregunta es obligatorio');
    }
    const pregunta =
      updateData?.pregunta !== undefined ? sanitizeInput(String(updateData.pregunta)) : undefined;
    if (updateData?.pregunta !== undefined && !pregunta) {
      throw new BadRequestException('La pregunta no puede estar vacía');
    }
    const activa = typeof updateData?.activa === 'boolean' ? updateData.activa : undefined;

    const existente = await this.prisma.preguntaDisponible.findUnique({ where: { id: idLimpio } });

    if (!existente) {
      if (!pregunta) {
        throw new BadRequestException('Para crear una pregunta nueva, el campo pregunta es obligatorio');
      }
      const creada = await this.prisma.preguntaDisponible.create({
        data: { id: idLimpio, pregunta, activa: activa ?? true },
      });
      return {
        success: true,
        message: 'Pregunta del catálogo creada',
        data: { id: creada.id, pregunta: creada.pregunta, activa: creada.activa },
      };
    }

    const actualizada = await this.prisma.preguntaDisponible.update({
      where: { id: idLimpio },
      data: {
        ...(pregunta !== undefined ? { pregunta } : {}),
        ...(activa !== undefined ? { activa } : {}),
      },
    });
    return {
      success: true,
      message: 'Pregunta del catálogo actualizada',
      data: { id: actualizada.id, pregunta: actualizada.pregunta, activa: actualizada.activa },
    };
  }

  /**
   * DELETE /pregunta-seguridad/:id (solo admin): desactiva la pregunta del catálogo (soft delete,
   * activa = false). No se borra la fila: las cuentas que ya la usan conservan su texto. Pide la contraseña actual
   * de quien hace el cambio.
   */
  async eliminarPregunta(id: string, usuarioId: string | undefined, passwordActual?: string) {
    await this.verificarPasswordActual(usuarioId, passwordActual);
    const idLimpio = sanitizeInput(String(id ?? ''));
    const existente = idLimpio
      ? await this.prisma.preguntaDisponible.findUnique({ where: { id: idLimpio } })
      : null;
    if (!existente) {
      throw new NotFoundException('Pregunta no encontrada');
    }
    const desactivada = await this.prisma.preguntaDisponible.update({
      where: { id: idLimpio },
      data: { activa: false },
    });
    return {
      success: true,
      message: 'Pregunta del catálogo desactivada',
      data: { id: desactivada.id, pregunta: desactivada.pregunta, activa: desactivada.activa },
    };
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
      throw new BadRequestException('Falta la respuesta a la pregunta de seguridad');
    }

    const preguntaTexto = keys[0];
    const respuestaPlano = String(answers[preguntaTexto] ?? '').trim();

    if (!respuestaPlano) {
      throw new BadRequestException('Respuesta vacía');
    }
    // "Por definir" (respuesta por defecto de la pantalla de admin) nunca vale, igual que en /api/auth.
    if (esRespuestaPorDefinir(respuestaPlano)) {
      throw new BadRequestException(DATOS_NO_COINCIDEN);
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

