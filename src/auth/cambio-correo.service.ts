import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { sanitizeEmail } from '../common/utils/security.util';
import { fechaHoraMexico } from '../usuarios/cambio-password';
import { TX_HOLGADA } from '../pos/salidas-caja';

export const VIGENCIA_CODIGO_CORREO_MINUTOS = 15;
export const MAX_INTENTOS_CODIGO_CORREO = 5;

// 400 y no 401: la web y la app tratan el 401 como sesión vencida y la cierran.
const passwordActualRequerida = () =>
  new BadRequestException({ message: 'Escribe tu contraseña actual para cambiar tu correo.', code: 'PASSWORD_ACTUAL_REQUERIDA' });
const passwordActualIncorrecta = () =>
  new BadRequestException({ message: 'La contraseña actual no es correcta.', code: 'PASSWORD_ACTUAL_INCORRECTA' });

const generarCodigo = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

/** Lo que se hashea: el código del correo nuevo y, si la cuenta no tiene contraseña, también el del actual. */
const materialCodigo = (codigo: string, codigoActual?: string) => (codigoActual ? `${codigo}:${codigoActual}` : codigo);

const correoEnUso = () =>
  new ConflictException({ message: 'Ese correo ya está registrado en otra cuenta.', code: 'CORREO_EN_USO' });
const codigoInvalido = () =>
  new BadRequestException({ message: 'El código no es válido. Pide un código nuevo.', code: 'CODIGO_INVALIDO' });

/**
 * Cambio de correo desde el perfil con un código de 6 dígitos enviado al correo nuevo
 * (tabla solicitudes_cambio_correo). Solo se guarda el hash bcrypt del código: el código no viaja
 * en la respuesta ni se escribe en los logs. El correo es el factor de recuperación: pedirlo exige la
 * contraseña actual (si la cuenta tiene) y confirmarlo avisa al correo anterior y anula la recuperación
 * de contraseña y los códigos pendientes. Una cuenta solo de Google no tiene contraseña: en su lugar se
 * le manda otro código al correo actual y hacen falta los dos (una sesión robada no basta para quedarse
 * con la cuenta cambiando el correo y recuperando la contraseña con el nuevo).
 */
@Injectable()
export class CambioCorreoService {
  private readonly logger = new Logger(CambioCorreoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * POST /auth/me/correo/solicitar. Con contraseña en la cuenta, `passwordActual` es obligatoria y se revisa
   * antes que el correo nuevo (así una sesión ajena no averigua qué correos tienen cuenta). Las cuentas solo de
   * Google no tienen contraseña: reciben un segundo código en el correo actual (`codigoAlCorreoActual`).
   */
  async solicitar(usuarioId: string, correoNuevoCrudo: string, passwordActual?: string) {
    const correoNuevo = sanitizeEmail(correoNuevoCrudo);
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, email: true, password: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    if (usuario.password) {
      if (typeof passwordActual !== 'string' || !passwordActual) throw passwordActualRequerida();
      if (!(await bcrypt.compare(passwordActual, usuario.password))) throw passwordActualIncorrecta();
    }
    if (usuario.email.toLowerCase() === correoNuevo) {
      throw new BadRequestException({
        message: 'El correo nuevo es igual al actual. Escribe uno distinto.',
        code: 'CORREO_IGUAL',
      });
    }
    await this.verificarDisponible(correoNuevo, usuarioId);

    const codigo = generarCodigo();
    // Sin contraseña: el código del correo actual hace de reautenticación. Se guarda un solo hash de los dos.
    const codigoActual = usuario.password ? null : generarCodigo();
    const codigoHash = await bcrypt.hash(materialCodigo(codigo, codigoActual ?? undefined), 10);
    const ahora = new Date();
    // Una solicitud nueva deja vencidas las pendientes: solo vale el último código.
    const solicitud = await this.prisma.$transaction(async (tx) => {
      await tx.solicitudCambioCorreo.updateMany({
        where: { usuarioId, usadoEn: null, expiraEn: { gt: ahora } },
        data: { expiraEn: ahora },
      });
      return tx.solicitudCambioCorreo.create({
        data: {
          usuarioId,
          correoNuevo,
          codigoHash,
          expiraEn: new Date(ahora.getTime() + VIGENCIA_CODIGO_CORREO_MINUTOS * 60_000),
        },
        select: { id: true },
      });
    }, TX_HOLGADA);

    try {
      await this.emailService.sendCodigoCambioCorreoEmail(correoNuevo, codigo, VIGENCIA_CODIGO_CORREO_MINUTOS);
      if (codigoActual) {
        await this.emailService.sendCodigoCorreoActualEmail(usuario.email, codigoActual, correoNuevo, VIGENCIA_CODIGO_CORREO_MINUTOS);
      }
    } catch {
      // Sin correo el código no le llegó a nadie: la solicitud queda vencida y sin intentos.
      try {
        await this.prisma.solicitudCambioCorreo.update({
          where: { id: solicitud.id },
          data: { expiraEn: new Date(), intentos: MAX_INTENTOS_CODIGO_CORREO },
        });
      } catch {
        this.logger.error(`No se pudo anular la solicitud de cambio de correo ${solicitud.id}`);
      }
      this.logger.warn(`No se pudo enviar el código de cambio de correo (usuario ${usuarioId})`);
      throw new BadGatewayException({
        message: 'No pudimos enviar el código a tu nuevo correo. Revisa que esté bien escrito o intenta de nuevo en unos minutos.',
        code: 'CORREO_NO_ENVIADO',
      });
    }

    return {
      success: true,
      message: codigoActual
        ? `Te enviamos un código a tu nuevo correo y otro a tu correo actual. Vencen en ${VIGENCIA_CODIGO_CORREO_MINUTOS} minutos.`
        : `Te enviamos un código a tu nuevo correo. Vence en ${VIGENCIA_CODIGO_CORREO_MINUTOS} minutos.`,
      vigenciaMinutos: VIGENCIA_CODIGO_CORREO_MINUTOS,
      codigoAlCorreoActual: codigoActual !== null,
    };
  }

  /** POST /auth/me/correo/confirmar. `codigoActual`: el del correo actual, en las cuentas sin contraseña. */
  async confirmar(usuarioId: string, codigo: string, codigoActual?: string) {
    const solicitud = await this.prisma.solicitudCambioCorreo.findFirst({
      where: { usuarioId, usadoEn: null },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    });
    if (!solicitud) {
      throw new BadRequestException({
        message: 'No tienes un cambio de correo pendiente. Pide un código nuevo.',
        code: 'SIN_SOLICITUD',
      });
    }
    if (solicitud.intentos >= MAX_INTENTOS_CODIGO_CORREO) {
      throw new BadRequestException({
        message: 'Llegaste al máximo de intentos. Pide un código nuevo.',
        code: 'INTENTOS_AGOTADOS',
      });
    }
    if (solicitud.expiraEn.getTime() <= Date.now()) {
      throw new BadRequestException({ message: 'El código venció. Pide uno nuevo.', code: 'CODIGO_VENCIDO' });
    }

    // Se aparta el intento antes de comparar (update condicional): aunque lleguen varias
    // peticiones a la vez, nunca se prueban más de MAX_INTENTOS_CODIGO_CORREO códigos.
    const reserva = await this.prisma.solicitudCambioCorreo.updateMany({
      where: { id: solicitud.id, intentos: solicitud.intentos, usadoEn: null },
      data: { intentos: { increment: 1 } },
    });
    if (reserva.count === 0) throw codigoInvalido();

    if (!(await bcrypt.compare(materialCodigo(codigo, codigoActual), solicitud.codigoHash))) {
      const restantes = MAX_INTENTOS_CODIGO_CORREO - (solicitud.intentos + 1);
      throw new BadRequestException({
        message:
          restantes > 0
            ? `El código no es correcto. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`
            : 'El código no es correcto. Llegaste al máximo de intentos: pide un código nuevo.',
        code: 'CODIGO_INCORRECTO',
      });
    }

    await this.verificarDisponible(solicitud.correoNuevo, usuarioId);
    const anterior = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { email: true } });
    try {
      await this.prisma.$transaction(async (tx) => {
        const marcada = await tx.solicitudCambioCorreo.updateMany({
          where: { id: solicitud.id, usadoEn: null },
          data: { usadoEn: new Date() },
        });
        if (marcada.count === 0) throw codigoInvalido();
        // Con el correo cambian los datos de recuperación: el enlace de restablecer contraseña y los códigos OTP
        // pendientes se pidieron con el correo anterior y dejan de valer.
        await tx.usuario.update({
          where: { id: usuarioId },
          data: {
            email: solicitud.correoNuevo,
            resetPasswordToken: null,
            resetPasswordExpires: null,
            codigoOTP: null,
            otpExpira: null,
          },
        });
      }, TX_HOLGADA);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw correoEnUso();
      throw e;
    }

    // Aviso al correo anterior: si no fue la titular, se entera aunque ya no pueda entrar con ese correo.
    if (anterior?.email) {
      try {
        await this.emailService.sendAvisoCorreoCambiadoEmail(anterior.email, fechaHoraMexico(new Date()));
      } catch {
        // El cambio se mantiene; el log no lleva correos.
        this.logger.warn(`No se pudo enviar el aviso de cambio de correo (usuario ${usuarioId})`);
      }
    }

    return { success: true, message: 'Listo, tu correo cambió.', data: { email: solicitud.correoNuevo } };
  }

  private async verificarDisponible(correo: string, usuarioId: string) {
    const otra = await this.prisma.usuario.findFirst({
      where: { email: { equals: correo, mode: 'insensitive' }, NOT: { id: usuarioId } },
      select: { id: true },
    });
    if (otra) throw correoEnUso();
  }
}
