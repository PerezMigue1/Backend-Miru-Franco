import { BadRequestException, CanActivate, ConflictException, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { DEEP_LINK_APP, challengeDeVerifier, firmarStateApp } from './google-app';

/**
 * Alta con Google: una cuenta NUEVA no se crea en el callback, ni en la web ni en la app (PKCE). El callback emite
 * un token firmado de 15 minutos (propósito registro_google, origen web o app) y manda a /auth/completar-registro
 * con el token en el fragmento (#token=), nunca en la query. POST /auth/google/completar crea la cuenta con sus
 * consentimientos; con origen web entrega la sesión como el canje web, con origen app no entrega sesión (la app
 * vuelve a entrar con Google). Las cuentas existentes siguen igual.
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
const { AuthService, firmarTokenRegistroGoogle, leerTokenRegistroGoogle } = require('./auth.service');

const SECRETO = 'secreto-falso-solo-para-pruebas';
const FRONTEND = 'https://web.falsa.example';
const CHALLENGE = challengeDeVerifier('verificador-falso-solo-para-pruebas-0123456789abcdef');
const HASH_TERMINOS = '6105ab7970cb21bbc1f8c629bd7da5a9952061cbc83741c5eced5ea68d1b4d69';
const HASH_AVISO = 'fae1b55c1fc51ab41088fdfdf8bb1ab4a84ad7a9eeca1d050e88cb1d100ef1bd';
const DOCUMENTOS = [
  { slug: 'terminos', version: '2.0', hash: HASH_TERMINOS },
  { slug: 'aviso-privacidad', version: '2.0', hash: HASH_AVISO },
];
const PERFIL_GOOGLE = {
  id: 'google-123',
  displayName: 'Ana Nueva',
  emails: [{ value: 'Ana.Nueva@Example.com' }],
  photos: [{ value: 'https://lh3.googleusercontent.com/foto-falsa' }],
};
const DATOS_TOKEN = { googleId: 'google-123', email: 'ana.nueva@example.com', nombre: 'Ana Nueva', foto: 'https://lh3.googleusercontent.com/foto-falsa' };
const CONTEXTO = { ip: '201.140.10.5', userAgent: 'Navegador de prueba' };

const envOriginal = { JWT_SECRET: process.env.JWT_SECRET, FRONTEND_URL: process.env.FRONTEND_URL };
function restaurarEnv(nombre: keyof typeof envOriginal) {
  if (envOriginal[nombre] === undefined) delete process.env[nombre];
  else process.env[nombre] = envOriginal[nombre];
}

function prismaFalso(opciones: { existente?: any } = {}) {
  const versiones = [
    { slug: 'terminos', version: '2.0', hashTexto: HASH_TERMINOS, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') },
    { slug: 'aviso-privacidad', version: '2.0', hashTexto: HASH_AVISO, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') },
  ];
  const orden: string[] = [];
  // La transacción recibe su propio cliente (tx): si el servicio usara this.prisma dentro del alta, el orden lo delata.
  const tx: any = {
    usuario: {
      create: jest.fn(async ({ data }: any) => {
        orden.push('tx.usuario.create');
        return { id: 'u-google-nueva', rol: 'cliente', ...data };
      }),
    },
    consentimiento: {
      createMany: jest.fn(async ({ data }: any) => {
        orden.push('tx.consentimiento.createMany');
        return { count: data.length };
      }),
    },
  };
  const prisma: any = {
    orden,
    tx,
    usuario: {
      findFirst: jest.fn(async () => opciones.existente ?? null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        orden.push('usuario.create');
        return { id: 'u-google-nueva', rol: 'cliente', ...data };
      }),
      update: jest.fn(async ({ where, data }: any) => ({ ...(opciones.existente ?? {}), id: where.id, ...data })),
    },
    consentimiento: {
      createMany: jest.fn(async ({ data }: any) => {
        orden.push('consentimiento.createMany');
        return { count: data.length };
      }),
    },
    versionDocumentoLegal: {
      findFirst: jest.fn(async ({ where }: any) =>
        versiones.find(
          (v) => v.slug === where.slug && (!where.version || v.version === where.version) && (!where.hashTexto || v.hashTexto === where.hashTexto),
        ) ?? null,
      ),
    },
    codigoOAuth: { create: jest.fn(async ({ data }: any) => data) },
    $transaction: jest.fn(async (fn: any) => {
      orden.push('inicio');
      const r = await fn(tx);
      orden.push('fin');
      return r;
    }),
  };
  return prisma;
}

function servicio(prisma = prismaFalso()) {
  const jwt = new JwtService({ secret: SECRETO });
  const security = { updateLastActivity: jest.fn().mockResolvedValue(undefined) };
  const config = { get: (k: string) => (k === 'FRONTEND_URL' ? FRONTEND : undefined) };
  const auth = new AuthService(jwt, prisma, {} as any, security as any, config as any, undefined);
  return { auth, jwt, prisma, security };
}

/** Ni dentro ni fuera de la transacción se creó la cuenta. */
function esperaNadaCreado(prisma: any) {
  expect(prisma.usuario.create).not.toHaveBeenCalled();
  expect(prisma.tx.usuario.create).not.toHaveBeenCalled();
}

/** Firma con Date.now desplazado: token vencido sin esperar 15 minutos. */
function firmarEnElPasado(msAtras: number) {
  const ahoraReal = Date.now.bind(Date);
  const espia = jest.spyOn(Date, 'now').mockImplementation(() => ahoraReal() - msAtras);
  try {
    return firmarTokenRegistroGoogle(DATOS_TOKEN, 'web');
  } finally {
    espia.mockRestore();
  }
}

/**
 * Redirección del alta: /auth/completar-registro sin query y con el token en el fragmento (#token=), que el
 * navegador no manda al servidor web (no queda en sus logs). Devuelve el token.
 */
function tokenDeRedireccionAlta(redireccion: string): string {
  const url = new URL(redireccion);
  expect(`${url.origin}${url.pathname}`).toBe(`${FRONTEND}/auth/completar-registro`);
  expect(url.search).toBe('');
  expect(redireccion).not.toContain('?token=');
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  expect(token).toBeTruthy();
  return token!;
}

/** Error que lanza Prisma cuando el correo o el googleId ya existen (carrera de dos envíos). */
const errorUnico = () => Object.assign(new Error('Unique'), { code: 'P2002' });

const cuerpoCompletar = (extra: Record<string, unknown> = {}) => ({
  token: firmarTokenRegistroGoogle(DATOS_TOKEN, 'web'),
  aceptaTerminos: true,
  aceptaAvisoPrivacidad: true,
  recibePromociones: false,
  documentos: DOCUMENTOS,
  ...extra,
});

describe('Alta con Google en la web', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRETO;
    process.env.FRONTEND_URL = FRONTEND;
  });
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    restaurarEnv('JWT_SECRET');
    restaurarEnv('FRONTEND_URL');
  });

  describe('GoogleStrategy.validate', () => {
    const estrategia = (prisma: any) =>
      new GoogleStrategy({ get: () => undefined } as any, prisma);

    it('usuaria nueva: NO crea la cuenta; entrega el alta pendiente con googleId, correo, nombre y foto', async () => {
      const prisma = prismaFalso();
      const done = jest.fn();
      await estrategia(prisma).validate('a', 'r', PERFIL_GOOGLE, done);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(null, { registroGooglePendiente: true, ...DATOS_TOKEN });
    });

    it('cuenta existente: entra igual que hoy (liga googleId si faltaba)', async () => {
      const existente = { id: 'u-1', email: 'ana.nueva@example.com', googleId: null, foto: null };
      const prisma = prismaFalso({ existente });
      const done = jest.fn();
      await estrategia(prisma).validate('a', 'r', PERFIL_GOOGLE, done);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { googleId: 'google-123', confirmado: true, foto: DATOS_TOKEN.foto },
      });
      expect(done.mock.calls[0][1]).toMatchObject({ id: 'u-1' });
    });
  });

  describe('Callback web', () => {
    it('usuaria nueva: no se crea la cuenta y redirige a /auth/completar-registro con un token de 15 minutos (origen web) en el fragmento', async () => {
      const { auth, prisma } = servicio();
      const controller = new AuthController(auth);
      const res = { redirect: jest.fn() };
      await controller.googleAuthRedirect({ query: {}, user: { registroGooglePendiente: true, ...DATOS_TOKEN } }, res);

      esperaNadaCreado(prisma);
      expect(prisma.codigoOAuth.create).not.toHaveBeenCalled();
      const token = tokenDeRedireccionAlta(res.redirect.mock.calls[0][0]);
      expect(leerTokenRegistroGoogle(token)).toEqual({ ...DATOS_TOKEN, origen: 'web' });
      const payload: any = new JwtService({}).decode(token);
      expect(payload).toMatchObject({ proposito: 'registro_google', origen: 'web', ...DATOS_TOKEN });
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('el token de registro no sirve como sesión (otra llave): verificarlo con JWT_SECRET falla', () => {
      expect(() => new JwtService({ secret: SECRETO }).verify(firmarTokenRegistroGoogle(DATOS_TOKEN, 'web'))).toThrow();
      expect(() => new JwtService({ secret: SECRETO }).verify(firmarTokenRegistroGoogle(DATOS_TOKEN, 'app'))).toThrow();
    });

    it('cuenta existente: el flujo web de siempre (código de un solo uso hacia /auth/callback)', async () => {
      const { auth } = servicio();
      const controller = new AuthController(auth);
      const res = { redirect: jest.fn() };
      await controller.googleAuthRedirect({ query: {}, user: { id: 'u-1', email: 'p@example.com' } }, res);
      expect(res.redirect.mock.calls[0][0]).toMatch(/^https:\/\/web\.falsa\.example\/auth\/callback\?code=[0-9a-f]{64}&success=true$/);
    });

    it('app (state PKCE) con usuaria nueva: NO crea la cuenta (ni aceptaAvisoPrivacidad sin evidencia) y va a /auth/completar-registro con un token de origen app', async () => {
      const { auth, prisma } = servicio();
      const controller = new AuthController(auth);
      const res = { redirect: jest.fn() };
      await controller.googleAuthRedirect({ query: { state: firmarStateApp(CHALLENGE) }, user: { registroGooglePendiente: true, ...DATOS_TOKEN } }, res);

      esperaNadaCreado(prisma);
      expect(prisma.consentimiento.createMany).not.toHaveBeenCalled();
      expect(prisma.codigoOAuth.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redireccion: string = res.redirect.mock.calls[0][0];
      expect(redireccion.startsWith(DEEP_LINK_APP)).toBe(false);
      const token = tokenDeRedireccionAlta(redireccion);
      expect(leerTokenRegistroGoogle(token)).toEqual({ ...DATOS_TOKEN, origen: 'app' });
      const payload: any = new JwtService({}).decode(token);
      expect(payload).toMatchObject({ proposito: 'registro_google', origen: 'app', ...DATOS_TOKEN });
      expect(payload.exp - payload.iat).toBe(15 * 60);
      // El token de alta no lleva el challenge de la app
      expect(JSON.stringify(payload)).not.toContain(CHALLENGE);
    });
  });

  describe('AuthService.completarRegistroGoogle', () => {
    it('éxito: crea la cuenta y sus consentimientos en la misma transacción y entrega la sesión', async () => {
      const { auth, prisma, jwt, security } = servicio();
      const r = await auth.completarRegistroGoogle(cuerpoCompletar({ recibePromociones: true }), CONTEXTO);
      // Cuenta y consentimientos con el cliente de la transacción (tx), nunca con this.prisma
      expect(prisma.orden).toEqual(['inicio', 'tx.usuario.create', 'tx.consentimiento.createMany', 'fin']);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(prisma.consentimiento.createMany).not.toHaveBeenCalled();
      expect(prisma.tx.usuario.create.mock.calls[0][0].data).toMatchObject({
        nombre: 'Ana Nueva',
        email: 'ana.nueva@example.com',
        googleId: 'google-123',
        foto: DATOS_TOKEN.foto,
        password: null,
        aceptaAvisoPrivacidad: true,
        recibePromociones: true,
        confirmado: true,
        activo: true,
      });
      const filas = prisma.tx.consentimiento.createMany.mock.calls[0][0].data;
      expect(filas.map((f: any) => f.tipo)).toEqual(['terminos', 'aviso_privacidad', 'promociones']);
      for (const f of filas) {
        expect(f).toMatchObject({ usuarioId: 'u-google-nueva', accion: 'aceptado', formulario: 'registro_google', rutaOrigen: '/auth/completar-registro', ip: CONTEXTO.ip, userAgent: CONTEXTO.userAgent });
      }
      // Cada documento con su versión y hash; promociones (aceptadas) con la versión del aviso que las describe
      expect(filas[0]).toMatchObject({ tipo: 'terminos', documentoSlug: 'terminos', documentoVersion: '2.0', documentoHash: HASH_TERMINOS });
      expect(filas[1]).toMatchObject({ tipo: 'aviso_privacidad', documentoSlug: 'aviso-privacidad', documentoVersion: '2.0', documentoHash: HASH_AVISO });
      expect(filas[2]).toMatchObject({ tipo: 'promociones', documentoSlug: 'aviso-privacidad', documentoVersion: '2.0', documentoHash: HASH_AVISO });
      // Igual que el canje web: { success, token } con un JWT de sesión de la cuenta nueva
      expect(Object.keys(r).sort()).toEqual(['success', 'token']);
      expect(r.success).toBe(true);
      expect(jwt.verify(r.token)).toMatchObject({ id: 'u-google-nueva', email: 'ana.nueva@example.com' });
      expect(security.updateLastActivity).toHaveBeenCalledWith('u-google-nueva');
    });

    it('origen app: crea la cuenta y sus consentimientos en la misma transacción que la web y NO entrega sesión', async () => {
      const { auth, prisma, security } = servicio();
      const generar = jest.spyOn(auth, 'generateToken');
      const r = await auth.completarRegistroGoogle(
        cuerpoCompletar({ token: firmarTokenRegistroGoogle(DATOS_TOKEN, 'app'), recibePromociones: true }),
        CONTEXTO,
      );
      expect(prisma.orden).toEqual(['inicio', 'tx.usuario.create', 'tx.consentimiento.createMany', 'fin']);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
      expect(prisma.consentimiento.createMany).not.toHaveBeenCalled();
      expect(prisma.tx.usuario.create.mock.calls[0][0].data).toMatchObject({
        nombre: 'Ana Nueva',
        email: 'ana.nueva@example.com',
        googleId: 'google-123',
        password: null,
        aceptaAvisoPrivacidad: true,
        recibePromociones: true,
        confirmado: true,
        activo: true,
      });
      // aceptaAvisoPrivacidad true va con su fila de evidencia en la misma transacción
      const filas = prisma.tx.consentimiento.createMany.mock.calls[0][0].data;
      expect(filas.map((f: any) => f.tipo)).toEqual(['terminos', 'aviso_privacidad', 'promociones']);
      for (const f of filas) {
        expect(f).toMatchObject({ usuarioId: 'u-google-nueva', accion: 'aceptado', formulario: 'registro_google', rutaOrigen: '/auth/completar-registro', ip: CONTEXTO.ip, userAgent: CONTEXTO.userAgent });
      }
      expect(filas[1]).toMatchObject({ tipo: 'aviso_privacidad', documentoSlug: 'aviso-privacidad', documentoVersion: '2.0', documentoHash: HASH_AVISO });
      // Sin sesión: ni token ni código; la app vuelve a entrar con Google
      expect(r).toEqual({ success: true, data: { origen: 'app' } });
      expect(generar).not.toHaveBeenCalled();
      expect(security.updateLastActivity).not.toHaveBeenCalled();
      expect(prisma.codigoOAuth.create).not.toHaveBeenCalled();
    });

    it.each(['web', 'app'] as const)('origen %s: si el correo o el googleId chocan dentro de la transacción (P2002), 409', async (origen) => {
      const { auth, prisma } = servicio();
      prisma.tx.usuario.create.mockRejectedValueOnce(errorUnico());
      const error = await auth
        .completarRegistroGoogle(cuerpoCompletar({ token: firmarTokenRegistroGoogle(DATOS_TOKEN, origen) }), CONTEXTO)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('Ya existe una cuenta con este correo. Entra con Google para iniciar sesión.');
      expect(prisma.tx.consentimiento.createMany).not.toHaveBeenCalled();
    });

    it('sin promociones: solo terminos y aviso_privacidad', async () => {
      const { auth, prisma } = servicio();
      await auth.completarRegistroGoogle(cuerpoCompletar(), CONTEXTO);
      expect(prisma.tx.consentimiento.createMany.mock.calls[0][0].data.map((f: any) => f.tipo)).toEqual(['terminos', 'aviso_privacidad']);
      expect(prisma.tx.usuario.create.mock.calls[0][0].data.recibePromociones).toBe(false);
    });

    it('sin documentos en el cuerpo registra la versión vigente (con su hash) de términos y aviso', async () => {
      const { auth, prisma } = servicio();
      await auth.completarRegistroGoogle(cuerpoCompletar({ documentos: undefined }), CONTEXTO);
      const filas = prisma.tx.consentimiento.createMany.mock.calls[0][0].data;
      expect(filas.map((f: any) => [f.tipo, f.documentoSlug, f.documentoVersion, f.documentoHash])).toEqual([
        ['terminos', 'terminos', '2.0', HASH_TERMINOS],
        ['aviso_privacidad', 'aviso-privacidad', '2.0', HASH_AVISO],
      ]);
    });

    it.each([
      ['inválido', () => 'no-es-un-token'],
      ['alterado', () => firmarTokenRegistroGoogle(DATOS_TOKEN, 'web').slice(0, -3) + 'AAA'],
      ['vencido (más de 15 minutos)', () => firmarEnElPasado(16 * 60 * 1000)],
      ['firmado con JWT_SECRET (token de sesión)', () => new JwtService({ secret: SECRETO }).sign({ proposito: 'registro_google', ...DATOS_TOKEN })],
      ['state de la app (otro propósito)', () => firmarStateApp(CHALLENGE)],
    ])('token %s: 401 y no se crea nada', async (_caso, token) => {
      const { auth, prisma } = servicio();
      await expect(auth.completarRegistroGoogle(cuerpoCompletar({ token: token() }), CONTEXTO)).rejects.toBeInstanceOf(UnauthorizedException);
      esperaNadaCreado(prisma);
    });

    it('token firmado con la llave del alta pero sin el propósito registro_google: 401 (la firma sola no basta)', async () => {
      // Misma derivación que llaveRegistroGoogle en auth.service.ts
      const llave = createHmac('sha256', SECRETO).update('registro-google:v1').digest('hex');
      const firmar = (payload: object) => new JwtService({ secret: llave }).sign(payload, { expiresIn: 600 });
      // Control: con esa llave, el propósito y un origen válidos el token sí vale, así el rechazo de abajo no viene de la firma
      expect(leerTokenRegistroGoogle(firmar({ proposito: 'registro_google', origen: 'web', ...DATOS_TOKEN }))).toEqual({ ...DATOS_TOKEN, origen: 'web' });
      expect(leerTokenRegistroGoogle(firmar({ proposito: 'registro_google', origen: 'app', ...DATOS_TOKEN }))).toEqual({ ...DATOS_TOKEN, origen: 'app' });
      // Cada payload tiene un solo defecto (el resto es válido): así cada caso prueba una condición
      for (const payload of [
        { proposito: 'otro', origen: 'web', ...DATOS_TOKEN },
        { origen: 'web', ...DATOS_TOKEN },
        // Sin correo (mutante P3f)
        { proposito: 'registro_google', origen: 'web', googleId: 'google-123' },
        // Sin origen, o con uno que no es web ni app
        { proposito: 'registro_google', ...DATOS_TOKEN },
        { proposito: 'registro_google', origen: 'otro', ...DATOS_TOKEN },
      ]) {
        const { auth, prisma } = servicio();
        await expect(auth.completarRegistroGoogle(cuerpoCompletar({ token: firmar(payload) }), CONTEXTO)).rejects.toBeInstanceOf(UnauthorizedException);
        esperaNadaCreado(prisma);
      }
    });

    it.each([
      ['términos sin marcar', 'web', { aceptaTerminos: false }],
      ['aviso sin marcar', 'web', { aceptaAvisoPrivacidad: false }],
      ['términos sin marcar', 'app', { aceptaTerminos: false }],
      ['aviso sin marcar', 'app', { aceptaAvisoPrivacidad: false }],
    ])('%s (origen %s): 400 y no se crea nada', async (_caso, origen, extra) => {
      const { auth, prisma } = servicio();
      await expect(
        auth.completarRegistroGoogle(cuerpoCompletar({ token: firmarTokenRegistroGoogle(DATOS_TOKEN, origen), ...extra }), CONTEXTO),
      ).rejects.toBeInstanceOf(BadRequestException);
      esperaNadaCreado(prisma);
    });

    it('origen app con una cuenta que ya existe: 409 y no se crea nada', async () => {
      const { auth, prisma } = servicio(prismaFalso({ existente: { id: 'u-1' } }));
      await expect(
        auth.completarRegistroGoogle(cuerpoCompletar({ token: firmarTokenRegistroGoogle(DATOS_TOKEN, 'app') }), CONTEXTO),
      ).rejects.toBeInstanceOf(ConflictException);
      esperaNadaCreado(prisma);
    });

    it('versión de documento desconocida: 400', async () => {
      const { auth, prisma } = servicio();
      await expect(
        auth.completarRegistroGoogle(cuerpoCompletar({ documentos: [{ slug: 'terminos', version: '9.9', hash: HASH_TERMINOS }] }), CONTEXTO),
      ).rejects.toBeInstanceOf(BadRequestException);
      esperaNadaCreado(prisma);
    });

    it('si mientras tanto ya existe una cuenta con ese correo o googleId: 409', async () => {
      const { auth, prisma } = servicio(prismaFalso({ existente: { id: 'u-1' } }));
      await expect(auth.completarRegistroGoogle(cuerpoCompletar(), CONTEXTO)).rejects.toBeInstanceOf(ConflictException);
      esperaNadaCreado(prisma);
    });
  });

  describe('Ruta POST /api/auth/google/completar', () => {
    let app: INestApplication;
    let base: string;
    const authService = { completarRegistroGoogle: jest.fn() };
    const nadie: CanActivate = { canActivate: () => false };
    // La ruta permite 5 intentos por minuto: cada prueba avanza el reloj 2 minutos para no toparse con el límite.
    const ahoraReal = Date.now.bind(Date);
    let desfase = 0;

    beforeAll(async () => {
      const modulo = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [{ provide: AuthService, useValue: authService }, { provide: PrismaService, useValue: {} }],
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
      desfase += 120_000;
      jest.spyOn(Date, 'now').mockImplementation(() => ahoraReal() + desfase);
      authService.completarRegistroGoogle.mockReset().mockResolvedValue({ success: true, token: new JwtService({ secret: SECRETO }).sign({ id: 'u-google-nueva' }, { expiresIn: 3600 }) });
    });

    afterAll(async () => {
      await app.close();
    });

    const pedir = (cuerpo: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/api/auth/google/completar`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(cuerpo) });

    it.each([
      ['términos sin marcar', { aceptaTerminos: false }],
      ['aviso sin marcar', { aceptaAvisoPrivacidad: false }],
      ['sin token', { token: undefined }],
      ['documento con hash inválido', { documentos: [{ slug: 'terminos', version: '2.0', hash: 'abc' }] }],
    ])('%s: 400 sin llegar al servicio', async (_caso, extra) => {
      const r = await pedir(cuerpoCompletar(extra));
      expect(r.status).toBe(400);
      expect(authService.completarRegistroGoogle).not.toHaveBeenCalled();
    });

    it('modo cookie (X-Auth-Mode: cookie): Set-Cookie mf_session y sin token en el cuerpo, como el canje web', async () => {
      const r = await pedir(cuerpoCompletar(), { 'X-Auth-Mode': 'cookie', 'x-forwarded-for': '201.1.1.1', 'user-agent': 'Navegador de prueba' });
      expect(r.status).toBe(200);
      expect(r.headers.get('set-cookie')).toMatch(/^mf_session=/);
      const cuerpo = await r.json();
      expect(cuerpo).not.toHaveProperty('token');
      expect(cuerpo).toMatchObject({ success: true });
      expect(typeof cuerpo.renovarEnSegundos).toBe('number');
      // ip: req.ip (la de la conexión, como el límite de peticiones); el x-forwarded-for de quien pide no cuenta
      expect(authService.completarRegistroGoogle).toHaveBeenCalledWith(expect.objectContaining({ aceptaTerminos: true }), {
        ip: '127.0.0.1',
        userAgent: 'Navegador de prueba',
      });
    });

    it('sin la cabecera: el token va en el cuerpo (Bearer)', async () => {
      const r = await pedir(cuerpoCompletar());
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(await r.json()).toMatchObject({ success: true, token: expect.any(String) });
    });

    it.each([
      ['modo cookie', { 'X-Auth-Mode': 'cookie' }],
      ['Bearer', {}],
    ])('origen app (%s): 200 con { success, data: { origen: "app" } }, sin cookie ni token', async (_caso, headers) => {
      authService.completarRegistroGoogle.mockReset().mockResolvedValue({ success: true, data: { origen: 'app' } });
      const r = await pedir(cuerpoCompletar({ token: firmarTokenRegistroGoogle(DATOS_TOKEN, 'app') }), headers);
      expect(r.status).toBe(200);
      expect(r.headers.get('set-cookie')).toBeNull();
      expect(await r.json()).toEqual({ success: true, data: { origen: 'app' } });
    });
  });
});
