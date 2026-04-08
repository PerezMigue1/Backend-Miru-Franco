import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SecurityService } from '../../common/services/security.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';

// Extender ExtractJwt para obtener el token raw
const ExtractJwtFromRequest = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // Guardar token en request para verificación posterior
    (req as any).rawToken = token;
    return token;
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private static lastActivityDbErrorAt = 0;
  private static readonly lastActivityWriteByUser = new Map<string, number>();
  private static readonly activityWriteCooldownMs = 60_000;
  private readonly logger = new Logger(JwtStrategy.name);
  constructor(
    private configService: ConfigService,
    private securityService: SecurityService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'tu_secreto_temporal',
      passReqToCallback: true, // Permitir acceso al request completo
    });
  }

  async validate(req: Request, payload: any) {
    // Obtener token raw del request
    const rawToken = (req as any).rawToken;
    
    // Verificar si el token está en la blacklist
    if (rawToken) {
      const isRevoked = await this.securityService.isTokenRevoked(rawToken);
      if (isRevoked) {
        throw new UnauthorizedException('Token revocado. Por favor inicia sesión nuevamente.');
      }
    }
    
    // Verificar logout global (todos los tokens revocados)
    if (payload.iat) {
      const isRevokedByGlobalLogout = await this.securityService.isTokenRevokedByGlobalLogout(
        payload.id,
        payload.iat,
      );
      if (isRevokedByGlobalLogout) {
        throw new UnauthorizedException('Sesión cerrada. Por favor inicia sesión nuevamente.');
      }
    }
    
    // Verificar expiración y actividad contra la base de datos
    // Esto es más confiable que solo verificar el token JWT (que es inmutable)
    const isInactive = await this.securityService.isUserInactive(payload.id, 15);
    
    if (isInactive) {
      throw new UnauthorizedException('Sesión expirada por inactividad. Por favor inicia sesión nuevamente.');
    }
    
    // Actualizar última actividad en la base de datos (en background, no bloquear la respuesta)
    // Usar setImmediate para no bloquear la respuesta
    if (this.shouldWriteLastActivity(payload.id)) {
      setImmediate(async () => {
        try {
          await this.securityService.updateLastActivity(payload.id);
        } catch (error) {
          this.logBackgroundActivityError(error);
        }
      });
    }
    
    return { 
      id: payload.id, 
      email: payload.email,
      lastActivity: Math.floor(Date.now() / 1000), // Mantener compatibilidad con código existente
    };
  }

  private logBackgroundActivityError(error: unknown) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in (error as Record<string, unknown>)
        ? String((error as Record<string, unknown>).code)
        : undefined;

    if (code === 'P1001' || code === 'P1017') {
      const now = Date.now();
      if (now - JwtStrategy.lastActivityDbErrorAt < 10000) return;
      JwtStrategy.lastActivityDbErrorAt = now;
      this.logger.warn(
        `No se pudo actualizar última actividad (${code} - conexión DB inestable).`,
      );
      return;
    }

    this.logger.warn(
      `No se pudo actualizar última actividad: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  private shouldWriteLastActivity(userId: string): boolean {
    const now = Date.now();
    const last = JwtStrategy.lastActivityWriteByUser.get(userId) ?? 0;
    if (now - last < JwtStrategy.activityWriteCooldownMs) {
      return false;
    }
    JwtStrategy.lastActivityWriteByUser.set(userId, now);

    if (JwtStrategy.lastActivityWriteByUser.size > 2000) {
      for (const [id, ts] of JwtStrategy.lastActivityWriteByUser.entries()) {
        if (now - ts > JwtStrategy.activityWriteCooldownMs * 2) {
          JwtStrategy.lastActivityWriteByUser.delete(id);
        }
      }
    }
    return true;
  }
}
