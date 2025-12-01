import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

// Extender Request para incluir cookies y, opcionalmente, session
interface RequestWithSession extends Request {
  cookies?: Record<string, string>;
  session?: {
    csrfToken?: string;
  };
}

/**
 * Guard básico para protección CSRF
 * Verifica que las peticiones POST/PUT/DELETE/PATCH incluyan un token CSRF válido
 *
 * Estrategia:
 * - El middleware CSRF genera un token y lo guarda en cookie `csrf-token`
 * - El frontend debe enviar ese mismo valor en el header `X-CSRF-Token`
 * - Este guard compara ambos valores
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const method = request.method;

    // Solo proteger métodos que modifican datos
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return true;
    }

    // Obtener token CSRF del header o body
    const headerToken = (request.headers['x-csrf-token'] as string) || (request.body as any)?.csrfToken;
    // Obtener token almacenado en cookie (generado por CsrfMiddleware)
    const cookieToken = request.cookies?.['csrf-token'] || request.session?.csrfToken;

    const isProduction = process.env.NODE_ENV === 'production';

    // En desarrollo, si no hay cookie configurada, permitir para no bloquear pruebas locales
    if (!isProduction && !cookieToken) {
      return true;
    }

    // Verificar que ambos tokens existan y coincidan
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      throw new ForbiddenException('Token CSRF inválido o faltante');
    }

    return true;
  }
}

