import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HttpExceptionFilter,
  MENSAJE_ERROR_INTERNO,
  MENSAJE_SERVICIO_NO_DISPONIBLE,
} from './http-exception.filter';

/** Mensaje de Prisma tal como llega: ruta del servidor, línea de código, tabla y datos de la consulta. */
const MENSAJE_PRISMA = `
Invalid \`prisma.usuario.create()\` invocation in
C:\\Users\\Miguel Angel\\backend-miru\\src\\usuarios\\usuarios.service.ts:212:41

  209 const usuario = await this.prisma.usuario.create({
→ 212   data: { email: "ana.perez@example.com", telefono: "5512345678" }
Unique constraint failed on the fields: (\`email\`) in table \`usuarios\``;

function responder(exception: unknown, url = '/api/db/export-direct?meta=locks') {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url }) }),
  } as any;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] as Record<string, any> };
}

const sinDetalleInterno = (body: unknown) => {
  const texto = JSON.stringify(body);
  for (const fuga of ['usuarios.service', '.ts:', 'src\\\\', 'prisma.usuario', 'usuarios`', 'Unique constraint', 'ana.perez']) {
    expect(texto).not.toContain(fuga);
  }
};

describe('HttpExceptionFilter', () => {
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;
  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('un error de Prisma no controlado responde 500 genérico con referencia, sin rutas, código ni tablas', () => {
    const error = new Prisma.PrismaClientKnownRequestError(MENSAJE_PRISMA, { code: 'P2002', clientVersion: '5.22.0' });

    const { status, body } = responder(error);

    expect(status).toBe(500);
    expect(body).toMatchObject({ success: false, statusCode: 500, message: MENSAJE_ERROR_INTERNO });
    expect(body.referencia).toMatch(/^[0-9A-F]{8}$/);
    expect(body).not.toHaveProperty('stack');
    sinDetalleInterno(body);
  });

  it('el detalle va al log con la misma referencia, sin los datos de la consulta', () => {
    const error = new Prisma.PrismaClientKnownRequestError(MENSAJE_PRISMA, { code: 'P2002', clientVersion: '5.22.0' });

    const { body } = responder(error);

    const linea = String(errorLog.mock.calls[0][0]);
    expect(linea).toContain(`ref=${body.referencia}`);
    expect(linea).toContain('P2002');
    expect(linea).toContain('Unique constraint failed');
    expect(linea).not.toContain('ana.perez@example.com');
    expect(linea).not.toContain('5512345678');
    expect(linea).not.toContain('?meta=');
  });

  it.each([
    ['base inalcanzable (P1001)', new Prisma.PrismaClientInitializationError("Can't reach database server at `ep-x-pooler.neon.tech:5432`", '5.22.0', 'P1001')],
    ['pool agotado (P2024)', new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 10, connection limit: 9)', { code: 'P2024', clientVersion: '5.22.0' })],
    ['pg sin conexión', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
    ['pool de pg sin conexión libre', new Error('timeout exceeded when trying to connect')],
    ['conexión nueva de pg que no llega a tiempo', new Error('Connection terminated due to connection timeout')],
  ])('un error de conexión, %s, responde 503', (_caso, error) => {
    const { status, body } = responder(error);

    expect(status).toBe(503);
    expect(body).toMatchObject({ statusCode: 503, message: MENSAJE_SERVICIO_NO_DISPONIBLE });
    expect(body.referencia).toMatch(/^[0-9A-F]{8}$/);
    expect(JSON.stringify(body)).not.toMatch(/neon\.tech|connection pool|ECONNREFUSED/);
  });

  it('un 502 lanzado a propósito con texto para el usuario (verificador de tarjetas) lo conserva y lleva referencia', () => {
    const error = new HttpException(
      { error: 'No pudimos verificar la tarjeta. Revisa el número e intenta de nuevo.' },
      HttpStatus.BAD_GATEWAY,
    );

    const { status, body } = responder(error);

    expect(status).toBe(502);
    expect(body.error).toBe('No pudimos verificar la tarjeta. Revisa el número e intenta de nuevo.');
    expect(body.referencia).toMatch(/^[0-9A-F]{8}$/);
  });

  it('un 503 lanzado con el mensaje genérico (export-direct sin pool) sale como 503 genérico', () => {
    const { status, body } = responder(new ServiceUnavailableException(MENSAJE_SERVICIO_NO_DISPONIBLE));

    expect(status).toBe(503);
    expect(body.message).toBe(MENSAJE_SERVICIO_NO_DISPONIBLE);
  });

  it('un 500 lanzado con un mensaje crudo también sale genérico', () => {
    const { status, body } = responder(new InternalServerErrorException(MENSAJE_PRISMA));

    expect(status).toBe(500);
    expect(body.message).toBe(MENSAJE_ERROR_INTERNO);
    sinDetalleInterno(body);
  });

  it('un error no controlado cualquiera (TypeError) responde 500 genérico', () => {
    const { status, body } = responder(new TypeError("Cannot read properties of undefined (reading 'id')"));

    expect(status).toBe(500);
    expect(body.message).toBe(MENSAJE_ERROR_INTERNO);
    expect(JSON.stringify(body)).not.toContain('reading');
  });

  it('un 400 conserva su mensaje y no lleva referencia', () => {
    const { status, body } = responder(new BadRequestException('Nombre de tabla no válido'));

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'Bad Request', message: 'Nombre de tabla no válido' });
    expect(body).not.toHaveProperty('referencia');
    expect(warnLog).toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('un 429 del límite de intentos conserva su mensaje', () => {
    const limite = new HttpException(
      { success: false, message: 'Demasiadas solicitudes. Intenta de nuevo en 42 segundos.', retryAfter: 42 },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    const { status, body } = responder(limite);

    expect(status).toBe(429);
    expect(body.message).toBe('Demasiadas solicitudes. Intenta de nuevo en 42 segundos.');
    expect(body).not.toHaveProperty('referencia');
  });

  it('un 401 conserva su mensaje', () => {
    const { status, body } = responder(new UnauthorizedException('Token revocado. Por favor inicia sesión nuevamente.'));

    expect(status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized', message: 'Token revocado. Por favor inicia sesión nuevamente.' });
  });
});
