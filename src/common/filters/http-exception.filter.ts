import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Filtro global de excepciones.
 * Asegura que todas las respuestas de error sigan el formato de la guía:
 * - 400: validación o petición incorrecta → { success, error, message, errors? }
 * - 403: sin permisos → { success, error, message }
 * - 500: error interno → { success, error, message } (sin detalles en producción)
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly logCooldownMs = 5000;
  private readonly logDedup = new Map<string, number>();

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    if (response.headersSent) {
      return;
    }

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.buildErrorBody(exception, status, request.url);

    // Log: en producción no loguear stack al cliente; sí en consola del servidor
    this.logError(exception, status, request.url);

    response.status(status).json(body);
  }

  private buildErrorBody(
    exception: unknown,
    status: number,
    path: string,
  ): Record<string, unknown> {
    const base = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
    };

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const msg = typeof res === 'string' ? res : (res as Record<string, unknown>);

      const error =
        typeof msg === 'object' && msg !== null && typeof msg.error === 'string'
          ? msg.error
          : this.getDefaultError(status);
      const message = this.normalizeMessage(msg);
      const errors =
        typeof msg === 'object' && msg !== null && 'errors' in msg && typeof (msg as any).errors === 'object'
          ? (msg as any).errors
          : undefined;
      const code =
        typeof msg === 'object' && msg !== null && 'code' in msg && typeof (msg as any).code === 'string'
          ? (msg as any).code
          : undefined;

      return {
        ...base,
        error,
        message,
        ...(code ? { code } : {}),
        ...(errors && Object.keys(errors).length > 0 ? { errors } : {}),
      };
    }

    // 500: no exponer detalles internos en producción
    const isProd = process.env.NODE_ENV === 'production';
    return {
      ...base,
      error: isProd ? 'Error interno del servidor' : (exception as Error)?.message || 'Error interno del servidor',
      message: isProd
        ? 'Algo salió mal. Por favor intenta más tarde.'
        : (exception as Error)?.message || 'Error interno del servidor',
    };
  }

  private normalizeMessage(msg: unknown): string {
    if (typeof msg === 'string') return msg;
    if (typeof msg !== 'object' || msg === null) return 'Error en la solicitud';

    const m = msg as Record<string, unknown>;
    if (typeof m.message === 'string') return m.message;
    if (Array.isArray(m.message) && m.message.length > 0) {
      return typeof m.message[0] === 'string' ? m.message[0] : 'Revisa los campos del formulario';
    }
    return 'Revisa los campos del formulario';
  }

  private getDefaultError(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Solicitud incorrecta';
      case HttpStatus.FORBIDDEN:
        return 'No tienes permiso para realizar esta acción';
      case HttpStatus.NOT_FOUND:
        return 'Recurso no encontrado';
      case HttpStatus.UNAUTHORIZED:
        return 'No autorizado';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'Error interno del servidor';
      default:
        return 'Error en la solicitud';
    }
  }

  private logError(exception: unknown, status: number, path: string): void {
    const signature = this.buildLogSignature(exception, status, path);
    if (this.shouldSkipLog(signature)) {
      return;
    }

    const summary = this.getLogSummary(exception);
    if (status >= 500) {
      this.logger.error(`[${status}] ${path} - ${summary}`);
    } else {
      this.logger.warn(`[${status}] ${path} - ${summary}`);
    }
  }

  private buildLogSignature(
    exception: unknown,
    status: number,
    path: string,
  ): string {
    const prismaCode =
      typeof exception === 'object' &&
      exception !== null &&
      'code' in (exception as Record<string, unknown>) &&
      typeof (exception as Record<string, unknown>).code === 'string'
        ? (exception as Record<string, unknown>).code
        : '';
    const msg =
      exception instanceof Error
        ? exception.message
        : typeof exception === 'string'
          ? exception
          : JSON.stringify(exception);
    return `${status}|${path}|${prismaCode}|${msg}`;
  }

  private shouldSkipLog(signature: string): boolean {
    const now = Date.now();
    const lastTs = this.logDedup.get(signature);
    if (lastTs && now - lastTs < this.logCooldownMs) {
      return true;
    }
    this.logDedup.set(signature, now);

    if (this.logDedup.size > 200) {
      for (const [key, ts] of this.logDedup.entries()) {
        if (now - ts > this.logCooldownMs * 10) {
          this.logDedup.delete(key);
        }
      }
    }
    return false;
  }

  private getLogSummary(exception: unknown): string {
    const prismaCode =
      typeof exception === 'object' &&
      exception !== null &&
      'code' in (exception as Record<string, unknown>) &&
      typeof (exception as Record<string, unknown>).code === 'string'
        ? (exception as Record<string, unknown>).code
        : undefined;

    const msg =
      exception instanceof Error
        ? exception.message
        : typeof exception === 'string'
          ? exception
          : JSON.stringify(exception);

    if (prismaCode === 'P1001' || prismaCode === 'P1017') {
      return `Prisma ${prismaCode} (conexión a DB inestable): ${msg}`;
    }
    return msg;
  }
}
