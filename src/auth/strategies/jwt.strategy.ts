import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SecurityService } from '../../common/services/security.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';
import { leerTokenDeCookie } from '../auth-cookie';
import { jwtSecretObligatorio } from '../jwt-secret';
import { esTokenMovil } from '../sesion-movil';

// Extender ExtractJwt para obtener el token raw.
// Bearer (integraciones/scripts) tiene prioridad; si no hay, se usa la cookie httpOnly del
// frontend web. `authTransport` le dice a /auth/refresh cómo devolver el token nuevo.
export const ExtractJwtFromRequest = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // Guardar token en request para verificación posterior
    (req as any).rawToken = token;
    (req as any).authTransport = 'bearer';
    return token;
  }
  const cookieToken = leerTokenDeCookie(req);
  if (cookieToken) {
    (req as any).rawToken = cookieToken;
    (req as any).authTransport = 'cookie';
    return cookieToken;
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
      secretOrKey: jwtSecretObligatorio(configService.get<string>('JWT_SECRET')),
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

    // App móvil (canal movil): su token dura 15 min y la sesión la controla /auth/movil/renovar
    // (30 días sin uso). No aplica el corte de 15 min por inactividad ni escribe ultimaActividad,
    // que es por usuario: escribirla alargaría la sesión de la web de la misma cuenta.
    const esMovil = esTokenMovil(payload);
    if (esMovil) {
      // La sesión de la app sigue viva si su familia tiene una fila sin revocar: el logout, la
      // detección de reuso y logoutAll cortan el token de acceso al momento, sin esperar sus 15 min.
      // (Una rotación normal deja viva a la sucesora, así que el token anterior sigue sirviendo.)
      const familia = typeof payload.fam === 'string' ? payload.fam : null;
      const viva = familia
        ? await this.prisma.sesionMovil.findFirst({
            where: { familiaId: familia, usuarioId: payload.id, revocadaEn: null },
            select: { id: true },
          })
        : null;
      if (!viva) {
        throw new UnauthorizedException('Sesión cerrada. Por favor inicia sesión nuevamente.');
      }
    }

    // Verificar expiración y actividad contra la base de datos
    // Esto es más confiable que solo verificar el token JWT (que es inmutable)
    const isInactive = esMovil ? false : await this.securityService.isUserInactive(payload.id, 15);

    if (isInactive) {
      throw new UnauthorizedException('Sesión expirada por inactividad. Por favor inicia sesión nuevamente.');
    }

    // Actualizar última actividad en la base de datos (en background, no bloquear la respuesta)
    // Usar setImmediate para no bloquear la respuesta
    if (!esMovil && this.shouldWriteLastActivity(payload.id)) {
      setImmediate(async () => {
        try {
          await this.securityService.updateLastActivity(payload.id);
        } catch (error) {
          this.logBackgroundActivityError(error);
        }
      });
    }
    
    // El payload del JWT no incluye el rol; se obtiene de BD para que req.user.rol
    // esté disponible en los controladores (ej. quejas: crear/actualizar).
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.id },
      select: { rol: true },
    });

    // El token movil solo existe para clientas: si el rol cambió, no hereda permisos de personal.
    if (esMovil && usuario?.rol !== 'cliente') {
      throw new UnauthorizedException('Sesión cerrada. Por favor inicia sesión nuevamente.');
    }

    return {
      id: payload.id,
      email: payload.email,
      rol: usuario?.rol ?? null,
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
