import { PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Restos públicos de depuración: sin GET /auth/test, sin mensajes internos en la URL del callback de Google
 * y con el error de POST /subidas/firma en español.
 */

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthController } = require('./auth.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FirmaSubidaDto } = require('./subidas.controller');

const FRONTEND = 'https://web.falsa.example';

describe('AuthController', () => {
  const frontendOriginal = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = FRONTEND;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (frontendOriginal === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = frontendOriginal;
    jest.restoreAllMocks();
  });

  it('ya no expone GET /auth/test', () => {
    const rutas = Object.getOwnPropertyNames(AuthController.prototype).map((n) =>
      Reflect.getMetadata(PATH_METADATA, AuthController.prototype[n]),
    );
    expect(rutas).not.toContain('test');
  });

  it('el mensaje de arranque ya no anuncia GET /api/auth/test', () => {
    const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).not.toContain('/api/auth/test');
  });

  it('callback web con error interno: la URL no lleva el mensaje del error', async () => {
    const controller = new AuthController({ googleLogin: jest.fn().mockRejectedValue(new Error('P1001 detalle interno de la base')) });
    const res = { redirect: jest.fn() };
    await controller.googleAuthRedirect({ query: {}, user: { id: 'u-1' } }, res);
    expect(res.redirect).toHaveBeenCalledWith(`${FRONTEND}/auth/callback?error=authentication_failed`);
  });

  it('callback web sin usuaria: el texto del parámetro va codificado (sin espacios crudos)', async () => {
    const controller = new AuthController({ googleLogin: jest.fn() });
    const res = { redirect: jest.fn() };
    await controller.googleAuthRedirect({ query: {}, user: undefined, url: '/api/auth/google/callback', headers: {} }, res);
    const url: string = res.redirect.mock.calls[0][0];
    expect(url).not.toContain(' ');
    expect(url).toBe(`${FRONTEND}/auth/callback?error=authentication_failed&message=${encodeURIComponent('Usuario no autenticado')}`);
  });
});

describe('POST /subidas/firma: uso inválido', () => {
  it('el error de validación sale en español', async () => {
    const errores = await validate(plainToInstance(FirmaSubidaDto, { uso: 'perfil' }));
    expect(Object.values(errores[0].constraints ?? {})).toEqual(['El uso debe ser galeria o factura']);
  });
});
