import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';

// Cada RateLimitGuard arranca un setInterval de limpieza al importarse el controlador: se le quita
// el poder de mantener vivo el proceso (unref) para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthController } = require('./auth.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require('./auth.service');

describe('POST /api/auth/verificar-respuesta: límite de intentos', () => {
  let app: INestApplication;
  let base: string;
  const authService = { verificarRespuestaSeguridad: jest.fn().mockResolvedValue({ success: true }) };

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const modulo = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('el cuarto intento dentro de un minuto responde 429 y no llega al servicio', async () => {
    const intentar = () =>
      fetch(`${base}/api/auth/verificar-respuesta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alguien@example.com', respuesta: 'x' }),
      });

    const estados: number[] = [];
    for (let i = 0; i < 4; i++) estados.push((await intentar()).status);

    expect(estados).toEqual([200, 200, 200, 429]);
    expect(authService.verificarRespuestaSeguridad).toHaveBeenCalledTimes(3);
  });
});
