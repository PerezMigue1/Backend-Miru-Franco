import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { randomBytes } from 'crypto';

export const MENSAJE_ERROR_INTERNO = 'Ocurrió un error interno. Intenta de nuevo en unos segundos.';
export const MENSAJE_SERVICIO_NO_DISPONIBLE =
  'El servicio no está disponible en este momento. Intenta de nuevo en unos segundos.';

/** Prisma: base inalcanzable (P1001/P1002), timeouts (P1008), conexión cerrada (P1017), pool agotado (P2024). */
const CODIGOS_PRISMA_CONEXION = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
/** Red y Postgres (pg): sin conexión, apagado (57P01), aún no acepta (57P03), demasiadas conexiones (53300). */
const CODIGOS_RED_PG = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  '57P01',
  '57P03',
  '53300',
]);
const MENSAJES_CONEXION =
  /Can't reach database server|Timed out fetching a new connection|timeout exceeded when trying to connect|Connection terminated|Server has closed the connection/i;

/** true si el error es de conexión a la base (caída, inalcanzable o pool agotado), no de la consulta. */
export function esErrorDeConexion(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') return false;
  const e = exception as { name?: unknown; code?: unknown; errorCode?: unknown; message?: unknown };
  if (e.name === 'PrismaClientInitializationError') return true;
  const codigo = typeof e.code === 'string' ? e.code : typeof e.errorCode === 'string' ? e.errorCode : '';
  if (CODIGOS_PRISMA_CONEXION.has(codigo) || CODIGOS_RED_PG.has(codigo)) return true;
  return typeof e.message === 'string' && MENSAJES_CONEXION.test(e.message);
}

/**
 * Resumen para el log de un error 5xx: nombre, código, primera y última línea del mensaje y dónde
 * se lanzó. Prisma pone en medio del mensaje los argumentos de la consulta (pueden traer datos
 * personales), así que esa parte no se guarda; además se enmascaran correos y números largos.
 */
export function resumenParaLog(exception: unknown): string {
  if (!(exception instanceof Error)) {
    return typeof exception === 'string' ? exception.slice(0, 300) : 'Error no identificado';
  }
  const e = exception as Error & { code?: unknown; errorCode?: unknown };
  const codigo = typeof e.code === 'string' ? e.code : typeof e.errorCode === 'string' ? e.errorCode : '';
  const lineas = String(e.message ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const primera = lineas[0] ?? '';
  const ultima = lineas.length > 1 ? lineas[lineas.length - 1] : '';
  const mensaje = [primera, ultima]
    .filter(Boolean)
    .join(' … ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<correo>')
    .replace(/\d{7,}/g, '<número>')
    .slice(0, 300);
  const donde = (e.stack ?? '')
    .split('\n')
    .slice(1)
    .find((l) => !l.includes('node_modules'))
    ?.trim();
  return `${e.name}${codigo ? ` ${codigo}` : ''}: ${mensaje}${donde ? ` (${donde})` : ''}`;
}

/**
 * Filtro global de excepciones.
 * - 4xx (HttpException): el mensaje pensado para el usuario, sin cambios.
 * - 503: base caída o pool de conexiones agotado → mensaje genérico de servicio no disponible.
 * - 502/503/504 lanzados a propósito (HttpException): su mensaje, como antes.
 * - 500 y cualquier error no controlado (Prisma incluido) → mensaje genérico.
 * Los 5xx llevan `referencia`, un id corto que aparece junto al detalle en el log del servidor; al
 * navegador nunca llegan rutas, código, SQL ni nombres de tablas.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly logCooldownMs = 5000;
  private readonly logDedup = new Map<string, { ts: number; referencia?: string }>();

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    if (response.headersSent) {
      return;
    }

    const httpStatus = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    // Sin query string en el log: puede llevar datos personales (p. ej. /pregunta-seguridad/por-email?email=…)
    const pathLog = String(request.url ?? '').split('?')[0];

    if (httpStatus < 500) {
      this.logError(exception, httpStatus, pathLog);
      response.status(httpStatus).json(this.buildErrorBody(exception, httpStatus, request.url));
      return;
    }

    const referencia = randomBytes(4).toString('hex').toUpperCase();
    const conexion = esErrorDeConexion(exception);

    // 502/503/504 lanzados a propósito con texto para el usuario (p. ej. el verificador de tarjetas
    // del checkout): conservan su mensaje y llevan referencia. Los 500 nunca: suelen envolver errores crudos.
    if (exception instanceof HttpException && httpStatus !== HttpStatus.INTERNAL_SERVER_ERROR && !conexion) {
      this.logErrorInterno(exception, httpStatus, pathLog, referencia);
      response
        .status(httpStatus)
        .json({ ...this.buildErrorBody(exception, httpStatus, request.url), referencia });
      return;
    }

    const status = conexion ? HttpStatus.SERVICE_UNAVAILABLE : httpStatus;
    this.logErrorInterno(exception, status, pathLog, referencia);

    const noDisponible = status === HttpStatus.SERVICE_UNAVAILABLE;
    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: noDisponible ? 'Servicio no disponible' : 'Error interno del servidor',
      message: noDisponible ? MENSAJE_SERVICIO_NO_DISPONIBLE : MENSAJE_ERROR_INTERNO,
      referencia,
    });
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

    return { ...base, error: this.getDefaultError(status), message: 'Error en la solicitud' };
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

  /**
   * 5xx: siempre una línea con la referencia, para poder encontrar el error que vio el usuario. Si
   * el mismo error se repite en 5 s, la línea remite a la referencia anterior en vez de repetir el detalle.
   */
  private logErrorInterno(exception: unknown, status: number, path: string, referencia: string): void {
    const signature = this.buildLogSignature(exception, status, path);
    const previo = this.logDedup.get(signature);
    const now = Date.now();
    if (previo && now - previo.ts < this.logCooldownMs && previo.referencia) {
      this.logger.error(`[${status}] ${path} ref=${referencia} - igual que ref=${previo.referencia}`);
      return;
    }
    this.recordarLog(signature, now, referencia);
    const conexion = status === HttpStatus.SERVICE_UNAVAILABLE ? ' (conexión a la base)' : '';
    this.logger.error(`[${status}] ${path} ref=${referencia}${conexion} - ${resumenParaLog(exception)}`);
  }

  /** 4xx: aviso con el mensaje del error, sin repetir el mismo en 5 s. */
  private logError(exception: unknown, status: number, path: string): void {
    const signature = this.buildLogSignature(exception, status, path);
    if (this.shouldSkipLog(signature)) {
      return;
    }
    this.logger.warn(`[${status}] ${path} - ${this.getLogSummary(exception)}`);
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
    const previo = this.logDedup.get(signature);
    if (previo && now - previo.ts < this.logCooldownMs) {
      return true;
    }
    this.recordarLog(signature, now);
    return false;
  }

  private recordarLog(signature: string, now: number, referencia?: string): void {
    this.logDedup.set(signature, { ts: now, referencia });
    if (this.logDedup.size > 200) {
      for (const [key, entrada] of this.logDedup.entries()) {
        if (now - entrada.ts > this.logCooldownMs * 10) {
          this.logDedup.delete(key);
        }
      }
    }
  }

  private getLogSummary(exception: unknown): string {
    return exception instanceof Error
      ? exception.message
      : typeof exception === 'string'
        ? exception
        : JSON.stringify(exception);
  }
}
