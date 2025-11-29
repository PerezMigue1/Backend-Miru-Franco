import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

// Extender Request para incluir session (opcional, solo si express-session está instalado)
interface RequestWithSession extends Request {
  session?: {
    csrfToken?: string;
  };
}

/**
 * Middleware para generar y verificar tokens CSRF
 * Nota: Requiere express-session para funcionar completamente
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: RequestWithSession, res: Response, next: NextFunction) {
    // Solo generar token para métodos GET (para que el frontend pueda obtenerlo)
    if (req.method === 'GET' && !req.path.includes('/api/')) {
      // Generar token CSRF si no existe
      // Si no hay session, usar cookie como alternativa
      if (!req.session) {
        req.session = {} as any;
      }
      
      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      }
      
      // Enviar token en header para que el frontend lo pueda leer
      res.setHeader('X-CSRF-Token', req.session.csrfToken);
    }
    
    next();
  }
}

