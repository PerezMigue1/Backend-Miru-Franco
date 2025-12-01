import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SecurityService {
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MINUTES = 15;

  constructor(private prisma: PrismaService) {}

  /**
   * Registra un intento de login fallido
   * Bloquea la cuenta después de MAX_LOGIN_ATTEMPTS intentos
   */
  async recordFailedLoginAttempt(email: string): Promise<void> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!usuario) {
      // No revelar si el usuario existe
      return;
    }

    const nuevosIntentos = (usuario.intentosLoginFallidos || 0) + 1;
    const bloqueoHasta =
      nuevosIntentos >= this.MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + this.LOCKOUT_DURATION_MINUTES * 60 * 1000)
        : null;

    await this.prisma.usuario.update({
      where: { email: email.toLowerCase() },
      data: {
        intentosLoginFallidos: nuevosIntentos,
        cuentaBloqueadaHasta: bloqueoHasta,
        ultimoIntentoLogin: new Date(),
      },
    });
  }

  /**
   * Resetea los intentos de login fallidos después de un login exitoso
   */
  async resetFailedLoginAttempts(email: string): Promise<void> {
    await this.prisma.usuario.updateMany({
      where: {
        email: email.toLowerCase(),
        intentosLoginFallidos: { gt: 0 },
      },
      data: {
        intentosLoginFallidos: 0,
        cuentaBloqueadaHasta: null,
      },
    });
  }

  /**
   * Verifica si la cuenta está bloqueada
   */
  async isAccountLocked(email: string): Promise<{ locked: boolean; until?: Date }> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        cuentaBloqueadaHasta: true,
        intentosLoginFallidos: true,
      },
    });

    if (!usuario) {
      return { locked: false };
    }

    // Si hay fecha de bloqueo y aún no ha expirado
    if (usuario.cuentaBloqueadaHasta && usuario.cuentaBloqueadaHasta > new Date()) {
      return {
        locked: true,
        until: usuario.cuentaBloqueadaHasta,
      };
    }

    // Si el bloqueo expiró, limpiarlo
    if (usuario.cuentaBloqueadaHasta && usuario.cuentaBloqueadaHasta <= new Date()) {
      await this.prisma.usuario.update({
        where: { email: email.toLowerCase() },
        data: {
          cuentaBloqueadaHasta: null,
          intentosLoginFallidos: 0,
        },
      });
    }

    return { locked: false };
  }

  /**
   * Verifica si un token JWT está en la blacklist
   */
  async isTokenRevoked(token: string): Promise<boolean> {
    const tokenRevocado = await this.prisma.tokenRevocado.findUnique({
      where: { token },
    });

    if (!tokenRevocado) {
      return false;
    }

    // Si el token expiró, limpiarlo
    if (tokenRevocado.expiraEn < new Date()) {
      await this.prisma.tokenRevocado.delete({
        where: { token },
      });
      return false;
    }

    return true;
  }

  /**
   * Agrega un token a la blacklist
   */
  async revokeToken(token: string, expiresAt: Date): Promise<void> {
    await this.prisma.tokenRevocado.create({
      data: {
        token,
        expiraEn: expiresAt,
      },
    });
  }

  /**
   * Limpia tokens expirados de la blacklist
   */
  async cleanupExpiredTokens(): Promise<void> {
    await this.prisma.tokenRevocado.deleteMany({
      where: {
        expiraEn: {
          lt: new Date(),
        },
      },
    });
  }

  /**
   * Verifica si un token está en la blacklist (usando jti del payload)
   * Nota: Para una verificación completa, necesitaríamos el token completo
   * Este método es un placeholder - la verificación real debe hacerse con el token completo
   */
  async isJtiRevoked(jti: string): Promise<boolean> {
    // Buscar en tokens revocados por jti
    // Nota: Esto requiere almacenar jti en la tabla tokens_revocados
    // Por ahora, esta es una implementación simplificada
    return false;
  }

  /**
   * Actualiza la última actividad del usuario
   * Se llama en cada petición autenticada para rastrear actividad
   */
  async updateLastActivity(userId: string): Promise<void> {
    await this.prisma.usuario.update({
      where: { id: userId },
      data: {
        ultimaActividad: new Date(),
      },
    });
  }

  /**
   * Verifica si el usuario ha estado inactivo por más del tiempo permitido
   * @param userId ID del usuario
   * @param inactivityTimeoutMinutes Tiempo de inactividad permitido en minutos (default: 15)
   * @returns true si está inactivo, false si está activo
   */
  async isUserInactive(userId: string, inactivityTimeoutMinutes: number = 15): Promise<boolean> {
    try {
      const usuario = await this.prisma.usuario.findUnique({
        where: { id: userId },
        select: {
          ultimaActividad: true,
        },
      });

      if (!usuario) {
        // Usuario no encontrado, considerar inactivo
        return true;
      }

      // Si no hay registro de actividad (null), permitir acceso (usuario nuevo o migración pendiente)
      // Pero actualizar la actividad para futuras verificaciones
      if (!usuario.ultimaActividad) {
        // No considerar inactivo si es null (podría ser usuario nuevo o migración no ejecutada)
        // Actualizar para que la próxima vez sí se verifique
        await this.updateLastActivity(userId);
        return false;
      }

      const now = new Date();
      const inactivityTimeout = inactivityTimeoutMinutes * 60 * 1000; // Convertir a milisegundos
      const timeSinceActivity = now.getTime() - usuario.ultimaActividad.getTime();

      return timeSinceActivity > inactivityTimeout;
    } catch (error: any) {
      // Si hay error (ej: columna no existe), no bloquear el acceso
      // Pero loggear el error para debugging
      if (error.message?.includes('ultima_actividad') || error.message?.includes('ultimaActividad')) {
        console.warn('⚠️ Campo ultima_actividad no existe. Ejecuta la migración SQL.');
      } else {
        console.error('Error verificando inactividad:', error);
      }
      // No bloquear acceso si hay error (fallback a comportamiento anterior)
      return false;
    }
  }
}

