import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SecurityService } from '../../common/services/security.service';
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
  constructor(
    private configService: ConfigService,
    private securityService: SecurityService,
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
    
    // Verificar expiración y actividad
    const now = Math.floor(Date.now() / 1000);
    const INACTIVITY_TIMEOUT = 15 * 60; // 15 minutos en segundos
    
    if (payload.lastActivity) {
      const timeSinceActivity = now - payload.lastActivity;
      if (timeSinceActivity > INACTIVITY_TIMEOUT) {
        throw new UnauthorizedException('Sesión expirada por inactividad. Por favor inicia sesión nuevamente.');
      }
    }
    
    return { 
      id: payload.id, 
      email: payload.email,
      lastActivity: payload.lastActivity || now,
    };
  }
}
