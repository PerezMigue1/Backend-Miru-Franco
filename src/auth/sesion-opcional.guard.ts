import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Sesión opcional para rutas públicas: con un JWT válido (cookie o Bearer) deja `req.user` como en
 * JwtAuthGuard; sin token, o con uno inválido o revocado, la petición sigue como anónima (`req.user`
 * null). Nunca rechaza. Lo usa POST /usuarios/registro para respetar `confirmado` solo si quien
 * registra es admin (pantalla de admin "nuevo usuario").
 */
@Injectable()
export class SesionOpcionalGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: unknown): TUser {
    return (user || null) as TUser;
  }
}
