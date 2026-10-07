import { BadRequestException, CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Rutas del cambio de contraseña: contrato HTTP (validación, límites, dueña de la cuenta, cookie).
 * La lógica vive en UsuariosService (ver usuarios/cambio-password.spec.ts); aquí los servicios van simulados.
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
const { UsuariosController } = require('../usuarios/usuarios.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsuariosService } = require('../usuarios/usuarios.service');

const ID = 'usuaria-1';
const CUERPO = { actualPassword: 'Vieja#Clave92', nuevaPassword: 'Otra$Llave47', codigo: '482913' };

/** El JwtAuthGuard real necesita un JWT firmado; aquí la usuaria llega en un header de prueba. */
const guardFalso: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) throw new UnauthorizedException();
    req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
    return true;
  },
};

describe('Rutas del cambio de contraseña con código', () => {
  let app: INestApplication;
  let base: string;
  const authService = {
    solicitarCodigoCambioPassword: jest.fn(),
    cambiarPasswordConCodigo: jest.fn(),
  };
  const usuariosService = { cambiarPasswordConCodigo: jest.fn() };

  // RateLimitGuard cuenta por ventana de 60 s con Date.now: cada prueba empieza en una ventana nueva.
  const ahoraReal = Date.now.bind(Date);
  let desfase = 0;

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockImplementation(() => ahoraReal() + desfase);
    const modulo = await Test.createTestingModule({
      controllers: [AuthController, UsuariosController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsuariosService, useValue: usuariosService },
        // RolesGuard (otras rutas de UsuariosController) lo pide; estas rutas no lo usan.
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardFalso)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    desfase += 120_000;
    authService.solicitarCodigoCambioPassword.mockReset().mockResolvedValue({ success: true, message: 'ok', vigenciaMinutos: 10 });
    authService.cambiarPasswordConCodigo.mockReset().mockResolvedValue({ success: true, message: 'Tu contraseña cambió. Inicia sesión de nuevo.' });
    usuariosService.cambiarPasswordConCodigo.mockReset().mockResolvedValue({ success: true, message: 'Tu contraseña cambió. Inicia sesión de nuevo.' });
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const pedir = (metodo: string, ruta: string, cuerpo: unknown, usuaria: string | null = ID) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(usuaria ? { 'x-usuaria': usuaria } : {}) },
      body: JSON.stringify(cuerpo),
    });

  describe('POST /api/auth/me/password/codigo', () => {
    const ruta = '/api/auth/me/password/codigo';

    it('pide sesión', async () => {
      expect((await pedir('POST', ruta, { actualPassword: 'x' }, null)).status).toBe(401);
    });

    it('pasa la contraseña actual al servicio con el id de la sesión', async () => {
      const r = await pedir('POST', ruta, { actualPassword: 'Vieja#Clave92' });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ success: true, vigenciaMinutos: 10 });
      expect(authService.solicitarCodigoCambioPassword).toHaveBeenCalledWith(ID, 'Vieja#Clave92');
    });

    it('sin contraseña actual o con campos desconocidos: 400 sin llegar al servicio', async () => {
      expect((await pedir('POST', ruta, {})).status).toBe(400);
      expect((await pedir('POST', ruta, { actualPassword: 'x', email: 'otra@example.com' })).status).toBe(400);
      expect(authService.solicitarCodigoCambioPassword).not.toHaveBeenCalled();
    });

    it('el error del servicio llega con su code', async () => {
      authService.solicitarCodigoCambioPassword.mockRejectedValueOnce(
        new BadRequestException({ message: 'La contraseña actual no es correcta.', code: 'PASSWORD_ACTUAL_INCORRECTA' }),
      );
      const r = await pedir('POST', ruta, { actualPassword: 'mala' });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ code: 'PASSWORD_ACTUAL_INCORRECTA', message: 'La contraseña actual no es correcta.' });
    });

    it('límite: el cuarto intento dentro de un minuto responde 429 y no llega al servicio', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 4; i++) estados.push((await pedir('POST', ruta, { actualPassword: 'x' })).status);
      expect(estados).toEqual([200, 200, 200, 429]);
      expect(authService.solicitarCodigoCambioPassword).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST /api/auth/me/password', () => {
    const ruta = '/api/auth/me/password';

    it('cambia con contraseña actual, nueva y código; borra la cookie de sesión', async () => {
      const r = await pedir('POST', ruta, CUERPO);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ success: true, message: 'Tu contraseña cambió. Inicia sesión de nuevo.' });
      expect(authService.cambiarPasswordConCodigo).toHaveBeenCalledWith(ID, CUERPO.actualPassword, CUERPO.nuevaPassword, CUERPO.codigo);
      expect(r.headers.get('set-cookie') ?? '').toMatch(/mf_session=;/);
    });

    it('sin código, con nueva débil o con campos desconocidos: 400 sin llegar al servicio', async () => {
      const { codigo: _sinCodigo, ...sinCodigo } = CUERPO;
      expect((await pedir('POST', ruta, sinCodigo)).status).toBe(400);
      expect((await pedir('POST', ruta, { ...CUERPO, nuevaPassword: 'abc' })).status).toBe(400);
      desfase += 120_000;
      expect((await pedir('POST', ruta, { ...CUERPO, usuarioId: 'otra' })).status).toBe(400);
      expect(authService.cambiarPasswordConCodigo).not.toHaveBeenCalled();
    });

    it('si el servicio falla no borra la cookie', async () => {
      authService.cambiarPasswordConCodigo.mockRejectedValueOnce(
        new BadRequestException({ message: 'El código no es válido o ya venció.', code: 'CODIGO_INVALIDO' }),
      );
      const r = await pedir('POST', ruta, CUERPO);
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ code: 'CODIGO_INVALIDO' });
      expect(r.headers.get('set-cookie')).toBeNull();
    });

    it('límite: el sexto intento dentro de un minuto responde 429 y no llega al servicio', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 6; i++) estados.push((await pedir('POST', ruta, CUERPO)).status);
      expect(estados).toEqual([200, 200, 200, 200, 200, 429]);
      expect(authService.cambiarPasswordConCodigo).toHaveBeenCalledTimes(5);
    });
  });

  describe('PUT /api/usuarios/:id/cambiar-password (ruta vieja de la app)', () => {
    const ruta = `/api/usuarios/${ID}/cambiar-password`;

    it('sin código ya no cambia la contraseña: 400', async () => {
      const r = await pedir('PUT', ruta, { actualPassword: CUERPO.actualPassword, nuevaPassword: CUERPO.nuevaPassword });
      expect(r.status).toBe(400);
      expect(usuariosService.cambiarPasswordConCodigo).not.toHaveBeenCalled();
    });

    it('con código pasa por la misma lógica y borra la cookie', async () => {
      const r = await pedir('PUT', ruta, CUERPO);
      expect(r.status).toBe(200);
      expect(usuariosService.cambiarPasswordConCodigo).toHaveBeenCalledWith(ID, CUERPO.actualPassword, CUERPO.nuevaPassword, CUERPO.codigo);
      expect(r.headers.get('set-cookie') ?? '').toMatch(/mf_session=;/);
    });

    it('solo la dueña: otra cuenta (aunque sea admin) recibe 403', async () => {
      const otra = await pedir('PUT', ruta, CUERPO, 'otra-usuaria');
      expect(otra.status).toBe(403);
      const admin = await fetch(`${base}${ruta}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-usuaria': 'admin-1', 'x-rol': 'admin' },
        body: JSON.stringify(CUERPO),
      });
      expect(admin.status).toBe(403);
      expect(usuariosService.cambiarPasswordConCodigo).not.toHaveBeenCalled();
    });

    it('límite: el sexto intento dentro de un minuto responde 429', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 6; i++) estados.push((await pedir('PUT', ruta, CUERPO)).status);
      expect(estados).toEqual([200, 200, 200, 200, 200, 429]);
    });
  });
});
