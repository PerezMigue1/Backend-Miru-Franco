import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Guard simple para rate limiting en memoria
 * Para producción, considerar usar @nestjs/throttler
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly requests: Map<string, RateLimitEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = 5, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Limpiar entradas expiradas cada minuto
    setInterval(() => this.cleanup(), 60000);
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = this.getKey(request);

    const now = Date.now();
    const entry = this.requests.get(key);

    if (!entry || now > entry.resetTime) {
      // Primera solicitud o ventana expirada
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      // Límite excedido
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      throw new HttpException(
        {
          success: false,
          message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfter} segundos.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Incrementar contador
    entry.count++;
    return true;
  }

  private getKey(request: any): string {
    // Usar IP del cliente como clave
    const ip =
      request.ip ||
      request.connection?.remoteAddress ||
      request.headers['x-forwarded-for']?.split(',')[0] ||
      'unknown';

    // Incluir ruta para rate limiting específico por endpoint
    const path = request.path || request.url;

    return `${ip}:${path}`;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}


