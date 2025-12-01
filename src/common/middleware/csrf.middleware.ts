import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

// Extender Request para incluir cookies (cookie-parser) y, opcionalmente, session
interface RequestWithSession extends Request {
  cookies?: Record<string, string>;
  session?: {
    csrfToken?: string;
  };
}

/**
 * Middleware para generar y exponer tokens CSRF
 *
 * Estrategia:
 * - Genera un token aleatorio si no existe
 * - Lo almacena en una cookie `csrf-token`
 * - Lo expone también en el header `X-CSRF-Token` para que el frontend lo lea
 *
 * El guard `CsrfGuard` comparará:
 * - Header `X-CSRF-Token` (enviado por el frontend)
 * - Cookie `csrf-token` (generada por este middleware)
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    // Solo generar token para métodos GET (el frontend puede hacer un GET para obtenerlo)
    if (req.method === 'GET') {
      // Intentar obtener token desde cookie o session
      const existingCookieToken = req.cookies?.['csrf-token'];
      const existingSessionToken = req.session?.csrfToken;

      let csrfToken = existingCookieToken || existingSessionToken;

      // Si no existe, generarlo
      if (!csrfToken) {
        csrfToken = crypto.randomBytes(32).toString('hex');

        // Guardar en session si existe
        if (!req.session) {
          req.session = {} as any;
        }
        req.session.csrfToken = csrfToken;
      }

      // Enviar token en header para que el frontend lo pueda leer
      res.setHeader('X-CSRF-Token', csrfToken);

      // Guardar también en cookie (para que el guard pueda validar)
      const isProduction = process.env.NODE_ENV === 'production';
      // @ts-ignore - Express Response tiene cookie() cuando se usa cookie-parser
      (res as any).cookie('csrf-token', csrfToken, {
        httpOnly: false, // Debe ser legible por JS para enviarlo en el header
        sameSite: 'Lax',
        secure: isProduction,
      });
    }

    next();
  }
}

