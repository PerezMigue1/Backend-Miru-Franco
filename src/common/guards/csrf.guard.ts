import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Guard básico para protección CSRF
 * Verifica que las peticiones POST/PUT/DELETE incluyan un token CSRF válido
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // Solo proteger métodos que modifican datos
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return true;
    }

    // Obtener token CSRF del header o cookie
    const csrfToken = request.headers['x-csrf-token'] || request.body?.csrfToken;
    const sessionToken = request.cookies?.['csrf-token'] || request.session?.csrfToken;

    // En desarrollo, permitir sin token si no está configurado
    if (process.env.NODE_ENV !== 'production' && !sessionToken) {
      return true;
    }

    // Verificar que el token coincida
    if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
      throw new ForbiddenException('Token CSRF inválido o faltante');
    }

    return true;
  }
}

