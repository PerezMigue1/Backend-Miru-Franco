import { CanActivate, INestApplication, Logger, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { DEEP_LINK_APP, challengeDeVerifier, firmarStateApp, leerStateApp } from './google-app';

/**
 * Login con Google desde la app (PKCE): el guard de inicio (challenge y state), el state firmado,
 * el callback hacia el deep link, el canje con code_verifier y que nada sensible salga en los logs.
 * El flujo web (sin origen=app o sin state válido) queda igual.
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

const SECRETO = 'secreto-falso-solo-para-pruebas';
const FRONTEND = 'https://web.falsa.example';
const VERIFIER = 'verificador-falso-solo-para-pruebas-0123456789abcdef';
const OTRO_VERIFIER = 'otro-verificador-falso-para-pruebas-fedcba9876543210';
const CHALLENGE = challengeDeVerifier(VERIFIER);
const USUARIA = { id: 'u-1', email: 'p@example.com' };
const SESION_MOVIL = {
  token: 'token-acceso-movil-falso',
  refreshToken: 'token-renovacion-falso',
  refreshExpiraEn: '2026-11-06T12:00:00.000Z',
};
const DIEZ_MIN_Y_ALGO = 11 * 60 * 1000;

const envOriginal = { JWT_SECRET: process.env.JWT_SECRET, FRONTEND_URL: process.env.FRONTEND_URL };
function restaurarEnv(nombre: keyof typeof envOriginal) {
  if (envOriginal[nombre] === undefined) delete process.env[nombre];
  else process.env[nombre] = envOriginal[nombre];
}

/** Firma con Date.now desplazado (state vencido sin esperar 10 min). */
function firmarEnElPasado(challenge: string, msAtras = DIEZ_MIN_Y_ALGO): string {
  const ahoraReal = Date.now.bind(Date);
  const espia = jest.spyOn(Date, 'now').mockImplementation(() => ahoraReal() - msAtras);
  try {
    return firmarStateApp(challenge);
  } finally {
    espia.mockRestore();
  }
}

/** Prisma en memoria: solo lo que tocan googleLogin e intercambiarCodigoPorToken. */
function prismaEnMemoria(rol = 'cliente') {
  const filas = new Map<string, any>();
  const prisma = {
    filas,
    codigoOAuth: {
      create: jest.fn(async ({ data }: any) => {
        filas.set(data.codigo, { ...data });
        return { ...data };
      }),
      findUnique: jest.fn(async ({ where }: any) => (filas.has(where.codigo) ? { ...filas.get(where.codigo) } : null)),
      update: jest.fn(async ({ where, data }: any) => {
        const fila = filas.get(where.codigo);
        if (!fila) throw new Error('No existe');
        Object.assign(fila, data);
        return { ...fila };
      }),
      // Condicional como en Postgres: solo cuenta filas que cumplen todo el where (incluido usado: false)
      updateMany: jest.fn(async ({ where, data }: any) => {
        const fila = filas.get(where.codigo);
        if (!fila || (where.usado !== undefined && fila.usado !== where.usado)) return { count: 0 };
        Object.assign(fila, data);
        return { count: 1 };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const fila = filas.get(where.codigo);
        filas.delete(where.codigo);
        return fila;
      }),
    },
    usuario: {
      findUnique: jest.fn(async () => ({ ...USUARIA, rol, activo: true })),
    },
  };
  return prisma;
}

function servicioReal(rol = 'cliente') {
  const jwt = new JwtService({ secret: SECRETO });
  const prisma = prismaEnMemoria(rol);
  const security = { updateLastActivity: jest.fn().mockResolvedValue(undefined) };
  const sesiones = { emitir: jest.fn().mockResolvedValue(SESION_MOVIL) };
  const config = { get: (k: string) => (k === 'FRONTEND_URL' ? FRONTEND : undefined) };
  const auth = new AuthService(jwt, prisma as any, {} as any, security as any, config as any, sesiones as any);
  return { auth, jwt, prisma, security, sesiones };
}

/** Siembra un código de app como lo deja googleLogin: `codigo.challenge` en la base, `codigo` para la app. */
function sembrarCodigoApp(prisma: ReturnType<typeof prismaEnMemoria>, jwt: JwtService, challenge = CHALLENGE) {
  const codigo = crypto.randomBytes(32).toString('hex');
  prisma.filas.set(`${codigo}.${challenge}`, {
    codigo: `${codigo}.${challenge}`,
    token: jwt.sign(USUARIA),
    expiraEn: new Date(Date.now() + 5 * 60 * 1000),
    usado: false,
  });
  return codigo;
}

/** Cambia un carácter del medio de la firma (no el último: sus bits bajos pueden no contar). */
function alterarFirma(state: string): string {
  const [cabecera, cuerpo, firma] = state.split('.');
  const otro = firma[5] === 'A' ? 'B' : 'A';
  return `${cabecera}.${cuerpo}.${firma.slice(0, 5)}${otro}${firma.slice(6)}`;
}

async function estado401(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (e: any) {
    expect(e).toBeInstanceOf(UnauthorizedException);
    expect(e.getStatus()).toBe(401);
    return e.message;
  }
  throw new Error('se esperaba un 401');
}

describe('Google desde la app (PKCE)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRETO;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    restaurarEnv('JWT_SECRET');
    restaurarEnv('FRONTEND_URL');
    jest.restoreAllMocks();
  });

  describe('Rutas: inicio en Google y exchange-code', () => {
    let app: INestApplication;
    let base: string;
    const authService = { intercambiarCodigoPorToken: jest.fn() };
    const config = {
      get: (k: string) =>
        ({
          GOOGLE_CLIENT_ID: 'cliente-google-falso.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'secreto-google-falso',
          BACKEND_URL: 'http://localhost:3001',
        })[k],
    };
    const nadie: CanActivate = { canActivate: () => false };
    let logEspia: jest.SpyInstance;

    beforeAll(async () => {
      logEspia = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const modulo = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: authService },
          // Estrategia real: registra 'google' en passport; con NullStore el state viaja tal cual a Google
          GoogleStrategy,
          { provide: ConfigService, useValue: config },
          { provide: PrismaService, useValue: {} },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue(nadie)
        .compile();
      app = modulo.createNestApplication({ logger: false });
      app.setGlobalPrefix('api');
      app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    beforeEach(() => {
      authService.intercambiarCodigoPorToken.mockReset().mockResolvedValue({ success: true, token: 'token-falso' });
    });

    afterAll(async () => {
      await app.close();
      logEspia.mockRestore();
    });

    const iniciar = (query: Record<string, string>) =>
      fetch(`${base}/api/auth/google?${new URLSearchParams(query).toString()}`, { redirect: 'manual' });

    it('origen=app sin code_challenge: 400 sin ir a Google', async () => {
      const r = await iniciar({ origen: 'app' });
      expect(r.status).toBe(400);
      expect(r.headers.get('location')).toBeNull();
    });

    it.each([
      ['corto', 'corto'],
      ['43 caracteres con +', 'a'.repeat(42) + '+'],
      ['43 caracteres con =', 'a'.repeat(42) + '='],
    ])('origen=app con challenge inválido (%s): 400 sin location hacia Google', async (_caso, challenge) => {
      const r = await iniciar({ origen: 'app', code_challenge: challenge });
      expect(r.status).toBe(400);
      expect(r.headers.get('location') ?? '').not.toContain('accounts.google.com');
    });

    it('origen=app con challenge válido: 302 a Google con un state que trae ese challenge', async () => {
      const r = await iniciar({ origen: 'app', code_challenge: CHALLENGE });
      expect(r.status).toBe(302);
      const destino = new URL(r.headers.get('location') ?? '');
      expect(destino.hostname).toBe('accounts.google.com');
      expect(destino.searchParams.get('prompt')).toBe('select_account');
      const state = destino.searchParams.get('state');
      expect(state).toBeTruthy();
      expect(leerStateApp(state)).toEqual({ codeChallenge: CHALLENGE });
      // El challenge no viaja suelto a Google
      expect(destino.searchParams.get('code_challenge')).toBeNull();
    });

    it('sin origen (web): 302 a Google sin state, como siempre', async () => {
      const r = await iniciar({});
      expect(r.status).toBe(302);
      const destino = new URL(r.headers.get('location') ?? '');
      expect(destino.hostname).toBe('accounts.google.com');
      expect(destino.searchParams.get('prompt')).toBe('select_account');
      expect(destino.searchParams.has('state')).toBe(false);
    });

    it.each([
      ['corto', 'corto'],
      ['43 caracteres con /', 'a'.repeat(42) + '/'],
    ])('POST /api/auth/exchange-code con code_verifier inválido (%s): 400 sin llegar al servicio', async (_caso, verifier) => {
      const r = await fetch(`${base}/api/auth/exchange-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'a'.repeat(64), code_verifier: verifier }),
      });
      expect(r.status).toBe(400);
      expect(authService.intercambiarCodigoPorToken).not.toHaveBeenCalled();
    });

    it('POST /api/auth/exchange-code con code_verifier válido lo pasa al servicio', async () => {
      const r = await fetch(`${base}/api/auth/exchange-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'a'.repeat(64), code_verifier: VERIFIER, canal: 'movil' }),
      });
      expect(r.status).toBe(200);
      expect(authService.intercambiarCodigoPorToken).toHaveBeenCalledWith('a'.repeat(64), expect.objectContaining({ codeVerifier: VERIFIER, canal: 'movil' }));
    });
  });

  describe('state firmado', () => {
    it('el state de firmarStateApp se lee y devuelve su challenge', () => {
      expect(leerStateApp(firmarStateApp(CHALLENGE))).toEqual({ codeChallenge: CHALLENGE });
    });

    it('alterado: null', () => {
      const state = firmarStateApp(CHALLENGE);
      const [cabecera, cuerpo, firma] = state.split('.');
      const otroCuerpo = Buffer.from(
        JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url').toString()), cc: challengeDeVerifier(OTRO_VERIFIER) }),
      ).toString('base64url');
      expect(leerStateApp(`${cabecera}.${otroCuerpo}.${firma}`)).toBeNull();
      expect(leerStateApp(alterarFirma(state))).toBeNull();
    });

    it('firmado directamente con JWT_SECRET (mismo contenido): null', () => {
      const conSecretoDeSesion = new JwtService({ secret: SECRETO }).sign(
        { tipo: 'google-oauth-state', origen: 'app', cc: CHALLENGE },
        { expiresIn: 600 },
      );
      expect(leerStateApp(conSecretoDeSesion)).toBeNull();
    });

    it('no sirve como token de sesión: verificarlo con JWT_SECRET lanza error', () => {
      const state = firmarStateApp(CHALLENGE);
      expect(() => new JwtService({ secret: SECRETO }).verify(state)).toThrow();
    });

    it('vencido (más de 10 min): null', () => {
      expect(leerStateApp(firmarEnElPasado(CHALLENGE))).toBeNull();
    });

    it('vencido con temporizadores falsos: null', () => {
      jest.useFakeTimers({ now: Date.now() });
      const state = firmarStateApp(CHALLENGE);
      expect(leerStateApp(state)).toEqual({ codeChallenge: CHALLENGE });
      jest.setSystemTime(Date.now() + DIEZ_MIN_Y_ALGO);
      expect(leerStateApp(state)).toBeNull();
    });

    it('sin state, vacío o no string: null', () => {
      expect(leerStateApp(undefined)).toBeNull();
      expect(leerStateApp('')).toBeNull();
      expect(leerStateApp(['x'])).toBeNull();
    });
  });

  describe('Callback de Google (controller directo, AuthService real)', () => {
    let logEspia: jest.SpyInstance;
    let errorEspia: jest.SpyInstance;

    beforeEach(() => {
      logEspia = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      errorEspia = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      process.env.FRONTEND_URL = FRONTEND;
    });

    afterEach(() => {
      logEspia.mockRestore();
      errorEspia.mockRestore();
      restaurarEnv('FRONTEND_URL');
    });

    function montar() {
      const s = servicioReal();
      const controller = new AuthController(s.auth);
      const res = { redirect: jest.fn() };
      return { ...s, controller, res };
    }

    it('state de app y usuaria: deep link exacto con solo el código; en la base `codigo.challenge`', async () => {
      const { controller, res, prisma } = montar();
      const req = { query: { state: firmarStateApp(CHALLENGE) }, user: USUARIA };
      await controller.googleAuthRedirect(req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const url: string = res.redirect.mock.calls[0][0];
      const m = /^appmirufranco:\/\/auth\/callback\?code=([0-9a-f]{64})$/.exec(url);
      expect(m).not.toBeNull();
      const code = m![1];
      expect(url.startsWith(DEEP_LINK_APP)).toBe(true);
      expect(url).not.toContain(CHALLENGE);

      expect(prisma.codigoOAuth.create).toHaveBeenCalledTimes(1);
      expect(prisma.codigoOAuth.create.mock.calls[0][0].data.codigo).toBe(`${code}.${CHALLENGE}`);
    });

    it('state de app sin usuaria: deep link de error, sin message', async () => {
      const { controller, res, prisma } = montar();
      await controller.googleAuthRedirect({ query: { state: firmarStateApp(CHALLENGE) }, user: undefined }, res);
      expect(res.redirect).toHaveBeenCalledWith(`${DEEP_LINK_APP}?error=authentication_failed`);
      expect(res.redirect.mock.calls[0][0]).not.toContain('message');
      expect(prisma.codigoOAuth.create).not.toHaveBeenCalled();
    });

    it('state de app y falla googleLogin: deep link de error, sin message', async () => {
      const { controller, res } = montar();
      await controller.googleAuthRedirect({ query: { state: firmarStateApp(CHALLENGE) }, user: { id: 'u-1' } }, res);
      expect(res.redirect).toHaveBeenCalledWith(`${DEEP_LINK_APP}?error=authentication_failed`);
    });

    const flujoWeb = /^https:\/\/web\.falsa\.example\/auth\/callback\?code=([0-9a-f]{64})&success=true$/;

    it.each([
      ['alterado', () => alterarFirma(firmarStateApp(CHALLENGE))],
      ['firmado con JWT_SECRET', () => new JwtService({ secret: SECRETO }).sign({ tipo: 'google-oauth-state', origen: 'app', cc: CHALLENGE })],
      ['vencido', () => firmarEnElPasado(CHALLENGE)],
    ])('state %s: flujo web con FRONTEND_URL', async (_caso, state) => {
      const { controller, res, prisma } = montar();
      await controller.googleAuthRedirect({ query: { state: state() }, user: USUARIA }, res);
      const url: string = res.redirect.mock.calls[0][0];
      const m = flujoWeb.exec(url);
      expect(m).not.toBeNull();
      // Código web: sin challenge en la base
      expect(prisma.codigoOAuth.create.mock.calls[0][0].data.codigo).toBe(m![1]);
    });

    it('sin state: flujo web de siempre', async () => {
      const { controller, res, prisma } = montar();
      await controller.googleAuthRedirect({ query: {}, user: USUARIA }, res);
      const m = flujoWeb.exec(res.redirect.mock.calls[0][0]);
      expect(m).not.toBeNull();
      expect(prisma.codigoOAuth.create.mock.calls[0][0].data.codigo).toBe(m![1]);
    });

    it('state inválido y sin usuaria: error del flujo web (process.env.FRONTEND_URL)', async () => {
      const { controller, res } = montar();
      await controller.googleAuthRedirect({ query: { state: 'basura' }, user: undefined, url: '/api/auth/google/callback', headers: {} }, res);
      expect(res.redirect.mock.calls[0][0]).toMatch(/^https:\/\/web\.falsa\.example\/auth\/callback\?error=authentication_failed&message=/);
    });
  });

  describe('Canje del código (AuthService real, Prisma en memoria)', () => {
    let errorEspia: jest.SpyInstance;

    beforeEach(() => {
      errorEspia = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => errorEspia.mockRestore());

    it('verifier correcto, canal movil, Bearer, clienta: sesión móvil', async () => {
      const { auth, jwt, prisma, sesiones, security } = servicioReal('cliente');
      const code = sembrarCodigoApp(prisma, jwt);
      const r: any = await auth.intercambiarCodigoPorToken(code, { codeVerifier: VERIFIER, canal: 'movil', enCookie: false });
      expect(r).toMatchObject({ success: true, token: SESION_MOVIL.token, refreshToken: SESION_MOVIL.refreshToken });
      expect(sesiones.emitir).toHaveBeenCalledWith(USUARIA, undefined);
      expect(security.updateLastActivity).toHaveBeenCalledWith('u-1');
      expect(prisma.filas.get(`${code}.${CHALLENGE}`).usado).toBe(true);
    });

    it('verifier con formato válido pero distinto: 401', async () => {
      const { auth, jwt, prisma, sesiones } = servicioReal();
      const code = sembrarCodigoApp(prisma, jwt);
      await estado401(auth.intercambiarCodigoPorToken(code, { codeVerifier: OTRO_VERIFIER, canal: 'movil', enCookie: false }));
      expect(sesiones.emitir).not.toHaveBeenCalled();
      expect(prisma.filas.get(`${code}.${CHALLENGE}`).usado).toBe(false);
    });

    it('sin verifier, con el código que recibió la app: 401', async () => {
      const { auth, jwt, prisma } = servicioReal();
      const code = sembrarCodigoApp(prisma, jwt);
      await estado401(auth.intercambiarCodigoPorToken(code, { canal: 'movil', enCookie: false }));
      expect(prisma.filas.get(`${code}.${CHALLENGE}`).usado).toBe(false);
    });

    it('sin verifier, presentando `codigo.challenge` completo: 401', async () => {
      const { auth, jwt, prisma } = servicioReal();
      const code = sembrarCodigoApp(prisma, jwt);
      await estado401(auth.intercambiarCodigoPorToken(`${code}.${CHALLENGE}`, { canal: 'movil', enCookie: false }));
      expect(prisma.codigoOAuth.findUnique).not.toHaveBeenCalled();
      expect(prisma.filas.get(`${code}.${CHALLENGE}`).usado).toBe(false);
    });

    it('segundo canje del mismo código con el verifier correcto: 401 Código ya utilizado', async () => {
      const { auth, jwt, prisma } = servicioReal();
      const code = sembrarCodigoApp(prisma, jwt);
      await auth.intercambiarCodigoPorToken(code, { codeVerifier: VERIFIER, canal: 'movil', enCookie: false });
      expect(await estado401(auth.intercambiarCodigoPorToken(code, { codeVerifier: VERIFIER, canal: 'movil', enCookie: false }))).toBe(
        'Código ya utilizado',
      );
    });

    it('dos canjes simultáneos: solo uno sale bien', async () => {
      const { auth, jwt, prisma, sesiones } = servicioReal();
      const code = sembrarCodigoApp(prisma, jwt);
      const opciones = { codeVerifier: VERIFIER, canal: 'movil', enCookie: false };
      const resultados = await Promise.allSettled([
        auth.intercambiarCodigoPorToken(code, opciones),
        auth.intercambiarCodigoPorToken(code, opciones),
      ]);
      const bien = resultados.filter((r) => r.status === 'fulfilled');
      const mal = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(bien).toHaveLength(1);
      expect(mal).toHaveLength(1);
      expect(mal[0].reason).toBeInstanceOf(UnauthorizedException);
      expect(mal[0].reason.message).toBe('Código ya utilizado');
      // Los dos leyeron la fila sin usar; el update condicional decidió
      expect(prisma.codigoOAuth.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.codigoOAuth.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.codigoOAuth.updateMany).toHaveBeenCalledWith({
        where: { codigo: `${code}.${CHALLENGE}`, usado: false },
        data: { usado: true },
      });
      expect(sesiones.emitir).toHaveBeenCalledTimes(1);
    });

    it('código web sin verifier: sigue funcionando y devuelve el token guardado', async () => {
      const { auth, jwt, prisma, sesiones } = servicioReal();
      const codigo = crypto.randomBytes(32).toString('hex');
      const token = jwt.sign(USUARIA);
      prisma.filas.set(codigo, { codigo, token, expiraEn: new Date(Date.now() + 60_000), usado: false });
      const r = await auth.intercambiarCodigoPorToken(codigo, {});
      expect(r).toEqual({ success: true, token });
      expect(sesiones.emitir).not.toHaveBeenCalled();
    });

    it('código de app vencido con el verifier correcto: 401 y se borra', async () => {
      const { auth, jwt, prisma } = servicioReal();
      const code = sembrarCodigoApp(prisma, jwt);
      prisma.filas.get(`${code}.${CHALLENGE}`).expiraEn = new Date(Date.now() - 1000);
      expect(await estado401(auth.intercambiarCodigoPorToken(code, { codeVerifier: VERIFIER }))).toBe('Código expirado');
      expect(prisma.filas.has(`${code}.${CHALLENGE}`)).toBe(false);
    });
  });

  describe('Logs del flujo de app', () => {
    const espias: jest.SpyInstance[] = [];
    const salida = () =>
      espias
        .flatMap((e) => e.mock.calls)
        .map((args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '))
        .join('\n');

    beforeEach(() => {
      espias.push(
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      );
    });

    afterEach(() => {
      espias.splice(0).forEach((e) => e.mockRestore());
    });

    it('callback y canje correcto: ninguna salida trae código, challenge, verifier, state ni tokens', async () => {
      const { auth, prisma } = servicioReal('cliente');
      const controller = new AuthController(auth);
      const res = { redirect: jest.fn() };
      const state = firmarStateApp(CHALLENGE);

      await controller.googleAuthRedirect({ query: { state }, user: USUARIA, url: '/api/auth/google/callback' }, res);
      const code = /code=([0-9a-f]{64})$/.exec(res.redirect.mock.calls[0][0])![1];
      const tokenGuardado: string = prisma.filas.get(`${code}.${CHALLENGE}`).token;

      const r: any = await auth.intercambiarCodigoPorToken(code, { codeVerifier: VERIFIER, canal: 'movil', enCookie: false });
      expect(r.refreshToken).toBe(SESION_MOVIL.refreshToken);

      // El flujo sí escribió algo (si no, la prueba no probaría nada)
      expect(espias.some((e) => e.mock.calls.length > 0)).toBe(true);
      const texto = salida();
      for (const secreto of [code, CHALLENGE, VERIFIER, state, tokenGuardado, SESION_MOVIL.token, SESION_MOVIL.refreshToken]) {
        expect(texto).not.toContain(secreto);
      }
    });
  });
});
