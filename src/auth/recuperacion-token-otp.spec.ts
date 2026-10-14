import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { UsuariosService } from '../usuarios/usuarios.service';

/**
 * POST /api/auth/validar-token-recuperacion y POST /api/auth/verificar-otp: cuerpo validado, límite de
 * 5 intentos por minuto y respuestas que no revelan si el correo tiene cuenta.
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
const { AuthService } = require('./auth.service');

describe('Rutas: cuerpo validado y límite de intentos', () => {
  let app: INestApplication;
  let base: string;
  const authService = {
    validarTokenRecuperacion: jest.fn().mockResolvedValue({ success: true, valid: true }),
    verificarOTP: jest.fn().mockResolvedValue({ success: true }),
  };

  // RateLimitGuard cuenta por ventana de 60 s con Date.now: cada prueba empieza en una ventana nueva.
  const ahoraReal = Date.now.bind(Date);
  let desfase = 0;

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockImplementation(() => ahoraReal() + desfase);
    const modulo = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    desfase += 120_000;
    jest.clearAllMocks();
  });

  const pedir = (ruta: string, cuerpo: unknown) =>
    fetch(`${base}/api/auth/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  it.each([
    ['sin token', { email: 'a@example.com' }],
    ['token objeto', { email: 'a@example.com', token: { not: 'x' } }],
    ['token vacío', { email: 'a@example.com', token: '' }],
    ['correo inválido', { email: 'no-es-correo', token: 'abc' }],
  ])('validar-token-recuperacion %s: 400 y no llega al servicio', async (_caso, cuerpo) => {
    expect((await pedir('validar-token-recuperacion', cuerpo)).status).toBe(400);
    expect(authService.validarTokenRecuperacion).not.toHaveBeenCalled();
  });

  it.each(['validar-token-recuperacion', 'verificar-otp'])('%s: el sexto intento dentro de un minuto responde 429', async (ruta) => {
    const cuerpo = ruta === 'verificar-otp' ? { email: 'a@example.com', codigo: '123456' } : { email: 'a@example.com', token: 'abc' };
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) estados.push((await pedir(ruta, cuerpo)).status);
    expect(estados).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('Servicio', () => {
  function servicio(usuario: Record<string, unknown> | null) {
    const prisma = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue(usuario),
        findFirst: jest.fn().mockResolvedValue(usuario),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { s: new UsuariosService(prisma as any, {} as any, {} as any, {} as any), prisma };
  }

  it('validarTokenRecuperacion sin token: 400 sin consultar (Prisma ignoraría el filtro undefined)', async () => {
    const { s, prisma } = servicio({ id: 'u-1', email: 'a@example.com', nombre: 'A' });
    await expect(s.validarTokenRecuperacion('a@example.com', undefined as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.validarTokenRecuperacion('a@example.com', '')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
  });

  it('verificarOTP con un correo sin cuenta: el mismo 400 que un código incorrecto', async () => {
    const sinCuenta = await servicio(null).s.verificarOTP({ email: 'nadie@example.com', codigo: '123456' }).catch((x) => x);
    const incorrecto = await servicio({ id: 'u-1', codigoOTP: '654321', otpExpira: new Date(Date.now() + 60_000) })
      .s.verificarOTP({ email: 'a@example.com', codigo: '123456' })
      .catch((x) => x);
    expect(sinCuenta).toBeInstanceOf(BadRequestException);
    expect(sinCuenta.getStatus()).toBe(400);
    expect(sinCuenta.message).toBe(incorrecto.message);
  });
});
