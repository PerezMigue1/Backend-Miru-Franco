import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { SesionOpcionalGuard } from './sesion-opcional.guard';

/**
 * POST /api/auth/verificar-correo: límite de intentos y misma respuesta exista o no el correo, salvo
 * con sesión de admin. AuthService y UsuariosService son los reales; solo Prisma va simulado.
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsuariosService } = require('../usuarios/usuarios.service');

/** El guard real necesita un JWT firmado; aquí el rol de la sesión llega en un header de prueba. */
const sesionFalsa: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = req.headers['x-rol'] ? { id: 'u-sesion', rol: req.headers['x-rol'] } : null;
    return true;
  },
};

describe('POST /api/auth/verificar-correo', () => {
  let app: INestApplication;
  let base: string;
  const correos = new Set(['ana@example.com']);
  const prisma = {
    usuario: {
      findUnique: jest.fn(async ({ where }) => (correos.has(where.email) ? { id: 'u-1' } : null)),
    },
  };

  // RateLimitGuard cuenta por ventana de 60 s con Date.now: cada prueba empieza en una ventana nueva.
  const ahoraReal = Date.now.bind(Date);
  let desfase = 0;

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockImplementation(() => ahoraReal() + desfase);
    const usuarios = new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
    const auth = new AuthService({} as any, prisma as any, usuarios, {} as any, {} as any);
    const modulo = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    })
      .overrideGuard(SesionOpcionalGuard)
      .useValue(sesionFalsa)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    desfase += 120_000;
    prisma.usuario.findUnique.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = async (correo: string, rol?: string) => {
    const r = await fetch(`${base}/api/auth/verificar-correo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(rol ? { 'x-rol': rol } : {}) },
      body: JSON.stringify({ correo }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };

  it('anónimo: misma respuesta para un correo registrado y uno libre, sin consultar la base', async () => {
    const registrado = await pedir('ana@example.com');
    const libre = await pedir('nadie@example.com');
    expect(registrado).toEqual({ status: 200, cuerpo: { existe: false, message: 'Comprobaremos el correo al crear la cuenta' } });
    expect(libre).toEqual(registrado);
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('una sesión que no es de admin recibe la respuesta anónima', async () => {
    expect((await pedir('ana@example.com', 'cliente')).cuerpo.existe).toBe(false);
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('con sesión de admin recibe el valor real', async () => {
    expect((await pedir('ana@example.com', 'admin')).cuerpo.existe).toBe(true);
    expect((await pedir('nadie@example.com', 'admin')).cuerpo.existe).toBe(false);
  });

  it('la petición 11 dentro de un minuto responde 429', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 11; i++) estados.push((await pedir(`c${i}@example.com`)).status);
    expect(estados).toEqual([...Array(10).fill(200), 429]);
  });
});
