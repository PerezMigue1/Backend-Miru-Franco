import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/** Contrato HTTP del canal movil y del registro (servicios simulados). */

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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SesionOpcionalGuard } = require('./sesion-opcional.guard');

/** La sesión llega en un header de prueba (el JWT real se prueba en canal-movil.spec.ts). */
const sesionDePrueba = (opcional: boolean): CanActivate => ({
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) {
      if (opcional) return true;
      return false;
    }
    req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
    req.rawToken = 'token-de-prueba';
    req.authTransport = 'bearer';
    return true;
  },
});

describe('Rutas: canal movil y registro', () => {
  let app: INestApplication;
  let base: string;
  const authService = {
    login: jest.fn(),
    intercambiarCodigoPorToken: jest.fn(),
    renovarSesionMovil: jest.fn(),
    logout: jest.fn(),
  };
  const usuariosService = { crearUsuario: jest.fn() };
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
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesionDePrueba(false))
      .overrideGuard(SesionOpcionalGuard)
      .useValue(sesionDePrueba(true))
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
    authService.login.mockReset().mockResolvedValue({ success: true, token: 't' });
    authService.intercambiarCodigoPorToken.mockReset().mockResolvedValue({ success: true, token: 't' });
    authService.renovarSesionMovil.mockReset().mockResolvedValue({ success: true, token: 't2', refreshToken: 'r2', refreshExpiraEn: 'x' });
    authService.logout.mockReset().mockResolvedValue({ success: true });
    usuariosService.crearUsuario.mockReset().mockResolvedValue({ success: true });
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  const pedir = (ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(cuerpo) });

  describe('POST /api/auth/login', () => {
    const credenciales = { email: 'clienta@example.com', password: 'Vieja#Clave92' };

    it('acepta canal movil y dispositivo, y pasa si la petición es de cookie', async () => {
      await pedir('/api/auth/login', { ...credenciales, canal: 'movil', dispositivo: 'Pixel 8' });
      expect(authService.login).toHaveBeenLastCalledWith(expect.objectContaining({ canal: 'movil', dispositivo: 'Pixel 8' }), false);
      await pedir('/api/auth/login', credenciales, { 'X-Auth-Mode': 'cookie' });
      expect(authService.login).toHaveBeenLastCalledWith(expect.anything(), true);
    });

    it('canal desconocido o dispositivo de más de 80 caracteres: 400', async () => {
      expect((await pedir('/api/auth/login', { ...credenciales, canal: 'tablet' })).status).toBe(400);
      expect((await pedir('/api/auth/login', { ...credenciales, canal: 'movil', dispositivo: 'x'.repeat(81) })).status).toBe(400);
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/exchange-code', () => {
    it('pasa canal, dispositivo y el modo de la petición', async () => {
      await pedir('/api/auth/exchange-code', { code: 'abc', canal: 'movil', dispositivo: 'iPhone' });
      expect(authService.intercambiarCodigoPorToken).toHaveBeenLastCalledWith('abc', { canal: 'movil', dispositivo: 'iPhone', enCookie: false });
    });
  });

  describe('POST /api/auth/movil/renovar', () => {
    const ruta = '/api/auth/movil/renovar';

    it('es pública y devuelve los tokens nuevos', async () => {
      const r = await pedir(ruta, { refreshToken: 'token-renovacion-falso' });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ token: 't2', refreshToken: 'r2' });
      expect(authService.renovarSesionMovil).toHaveBeenCalledWith('token-renovacion-falso', expect.any(String));
    });

    it('sin refreshToken o con campos desconocidos: 400', async () => {
      expect((await pedir(ruta, {})).status).toBe(400);
      expect((await pedir(ruta, { refreshToken: 'x', usuarioId: 'otra' })).status).toBe(400);
      expect(authService.renovarSesionMovil).not.toHaveBeenCalled();
    });

    it('la ruta no tiene límite general por IP: muchas clientas detrás del proxy de Render no se bloquean', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 200; i++) estados.push((await pedir(ruta, { refreshToken: `token-de-clienta-${i}` })).status);
      expect(estados.every((s) => s === 200)).toBe(true);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('pasa el refreshToken del cuerpo', async () => {
      await pedir('/api/auth/logout', { refreshToken: 'token-renovacion-falso' }, { 'x-usuaria': 'u-1' });
      expect(authService.logout).toHaveBeenCalledWith('token-de-prueba', false, 'token-renovacion-falso');
    });
  });

  describe('POST /api/usuarios/registro', () => {
    const cuerpo = {
      nombre: 'Persona Nueva',
      email: 'nueva@example.com',
      telefono: '7710000000',
      password: 'Otra$Llave47',
      fechaNacimiento: '1995-03-10',
      preguntaSeguridad: { pregunta: '¿Color favorito?', respuesta: 'azul' },
      perfilCapilar: { tipoCabello: 'liso' },
      aceptaAvisoPrivacidad: true,
      confirmado: true,
    };

    it('sin sesión: confirmado no se respeta', async () => {
      await pedir('/api/usuarios/registro', cuerpo);
      expect(usuariosService.crearUsuario).toHaveBeenLastCalledWith(expect.anything(), { permitirConfirmado: false });
    });

    it('con sesión de clienta u otro rol: tampoco', async () => {
      await pedir('/api/usuarios/registro', cuerpo, { 'x-usuaria': 'u-1', 'x-rol': 'estilista' });
      expect(usuariosService.crearUsuario).toHaveBeenLastCalledWith(expect.anything(), { permitirConfirmado: false });
    });

    it('con sesión de admin (pantalla de admin "nuevo usuario"): se respeta', async () => {
      await pedir('/api/usuarios/registro', cuerpo, { 'x-usuaria': 'admin-1', 'x-rol': 'admin' });
      expect(usuariosService.crearUsuario).toHaveBeenLastCalledWith(expect.anything(), { permitirConfirmado: true });
    });
  });
});
