import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  INestApplication,
  Logger,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import type { AddressInfo } from 'node:net';
import { DATOS_NO_COINCIDEN, SIN_PREGUNTA_RECUPERACION } from '../usuarios/usuarios.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { EmailService } from '../email/email.service';

// Cada RateLimitGuard arranca un setInterval de limpieza al importarse el controlador: se le quita
// el poder de mantener vivo el proceso (unref) para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PreguntaSeguridadController } = require('./pregunta-seguridad.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PreguntaSeguridadService } = require('./pregunta-seguridad.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require('../prisma/prisma.service');

const PREGUNTA = '¿Mascota?';

/** Usuarios por correo; el que no está en el mapa no existe. */
async function usuariosDePrueba() {
  const hash = await bcrypt.hash('Firulais', 4);
  return {
    'sin-pregunta@example.com': { id: 'u-1', activo: true, googleId: null, preguntaSeguridad: null, respuestaSeguridad: null },
    'google@example.com': { id: 'u-2', activo: true, googleId: 'g-1', preguntaSeguridad: null, respuestaSeguridad: null },
    'inactivo@example.com': { id: 'u-3', activo: false, googleId: null, preguntaSeguridad: PREGUNTA, respuestaSeguridad: hash },
    'con-pregunta@example.com': { id: 'u-4', activo: true, googleId: null, preguntaSeguridad: PREGUNTA, respuestaSeguridad: hash },
  } as Record<string, Record<string, unknown>>;
}

function prismaCon(usuarios: Record<string, Record<string, unknown>>) {
  return {
    usuario: {
      findUnique: jest.fn(async ({ where }: { where: { email: string } }) => usuarios[where.email] ?? null),
    },
  };
}

async function errorDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('se esperaba un error');
}

describe('PreguntaSeguridadService: mismas respuestas que /api/auth', () => {
  let servicio: InstanceType<typeof PreguntaSeguridadService>;

  beforeAll(async () => {
    servicio = new PreguntaSeguridadService(prismaCon(await usuariosDePrueba()) as any);
  });

  it('por-email: inexistente, sin pregunta, de Google o inactivo dan el mismo 400 que /api/auth/pregunta-seguridad', async () => {
    for (const email of ['nadie@example.com', 'sin-pregunta@example.com', 'google@example.com', 'inactivo@example.com']) {
      const e = await errorDe(servicio.obtenerPreguntaPorEmail(email));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getStatus()).toBe(400);
      expect(e.message).toBe(SIN_PREGUNTA_RECUPERACION);
    }
  });

  it('por-email: si hay pregunta, conserva la forma de la respuesta', async () => {
    await expect(servicio.obtenerPreguntaPorEmail('con-pregunta@example.com')).resolves.toEqual({
      success: true,
      data: [{ id: 'u-4', pregunta: PREGUNTA }],
    });
  });

  it('verificar: inexistente, sin pregunta, de Google, inactivo, otra pregunta u otra respuesta dan el mismo 400 que /api/auth/verificar-respuesta', async () => {
    const casos: [string, Record<string, string>][] = [
      ['nadie@example.com', { [PREGUNTA]: 'Firulais' }],
      ['sin-pregunta@example.com', { [PREGUNTA]: 'Firulais' }],
      ['google@example.com', { [PREGUNTA]: 'Firulais' }],
      ['inactivo@example.com', { [PREGUNTA]: 'Firulais' }],
      ['con-pregunta@example.com', { '¿Otra?': 'Firulais' }],
      ['con-pregunta@example.com', { [PREGUNTA]: 'Otra' }],
    ];
    for (const [email, answers] of casos) {
      const e = await errorDe(servicio.verificarRespuesta(email, answers));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getStatus()).toBe(400);
      expect(e.message).toBe(DATOS_NO_COINCIDEN);
    }
  });

  it('verificar: si coincide, conserva la forma de la respuesta', async () => {
    await expect(servicio.verificarRespuesta('con-pregunta@example.com', { [PREGUNTA]: 'Firulais' })).resolves.toEqual({
      success: true,
    });
  });
});

describe('Rutas /api/pregunta-seguridad: límite de intentos y respuestas iguales', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [PreguntaSeguridadController],
      providers: [
        PreguntaSeguridadService,
        { provide: PrismaService, useValue: prismaCon(await usuariosDePrueba()) },
        { provide: EmailService, useValue: { sendNotificationEmail: jest.fn() } },
      ],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const leer = async (r: Response) => ({ status: r.status, body: await r.json() });

  it('GET por-email: inexistente responde igual que sin pregunta, y el cuarto intento en un minuto da 429', async () => {
    const pedir = (email: string) => fetch(`${base}/api/pregunta-seguridad/por-email?email=${encodeURIComponent(email)}`).then(leer);

    const inexistente = await pedir('nadie@example.com');
    const sinPregunta = await pedir('sin-pregunta@example.com');
    const google = await pedir('google@example.com');
    const cuarto = await pedir('con-pregunta@example.com');

    expect(inexistente.status).toBe(400);
    expect(inexistente.body.message).toBe(SIN_PREGUNTA_RECUPERACION);
    expect(sinPregunta).toEqual(inexistente);
    expect(google).toEqual(inexistente);
    expect(cuarto.status).toBe(429);
  });

  it('POST verificar: inexistente responde igual que sin pregunta, y el cuarto intento en un minuto da 429', async () => {
    const pedir = (email: string, answers: Record<string, string>) =>
      fetch(`${base}/api/pregunta-seguridad/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, answers }),
      }).then(leer);

    const inexistente = await pedir('nadie@example.com', { [PREGUNTA]: 'Firulais' });
    const sinPregunta = await pedir('sin-pregunta@example.com', { [PREGUNTA]: 'Firulais' });
    const incorrecta = await pedir('con-pregunta@example.com', { [PREGUNTA]: 'Otra' });
    const cuarto = await pedir('con-pregunta@example.com', { [PREGUNTA]: 'Firulais' });

    expect(inexistente.status).toBe(400);
    expect(inexistente.body.message).toBe(DATOS_NO_COINCIDEN);
    expect(sinPregunta).toEqual(inexistente);
    expect(incorrecta).toEqual(inexistente);
    expect(cuarto.status).toBe(429);
  });
});

describe('GET /pregunta-seguridad/por-email sin email', () => {
  it('400 "El correo es obligatorio" (antes 200 con success:false) y no consulta', async () => {
    const service = { obtenerPreguntaPorEmail: jest.fn() };
    const controller = new PreguntaSeguridadController(service);
    for (const email of [undefined, '']) {
      const e = await errorDe(controller.obtenerPreguntaPorEmail(email));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe('El correo es obligatorio');
    }
    expect(service.obtenerPreguntaPorEmail).not.toHaveBeenCalled();
  });
});

/** Contraseña ficticia de las cuentas de prueba (solo existe en esta prueba). */
const PASSWORD = 'ClaveFicticia-123';
const HASH_PASSWORD = bcrypt.hashSync(PASSWORD, 4);
const PASSWORD_REQUERIDA = 'Escribe tu contraseña actual para cambiar la pregunta de seguridad.';
const PASSWORD_INCORRECTA = 'La contraseña actual no es correcta.';
const CUENTA_GOOGLE = 'Tu cuenta entra con Google y no usa pregunta de seguridad.';

/** Cuentas por id para la reautenticación: u-1 con contraseña, u-g solo de Google. */
const CUENTAS: Record<string, Record<string, unknown>> = {
  'u-1': { id: 'u-1', email: 'clienta@example.com', password: HASH_PASSWORD, googleId: null },
  'admin-1': { id: 'admin-1', email: 'admin@example.com', password: HASH_PASSWORD, googleId: null },
  'u-g': { id: 'u-g', email: 'solo.google@example.com', password: null, googleId: 'g-1' },
};
const cuentaPorId = () => jest.fn(async ({ where }: { where: { id: string } }) => (CUENTAS[where.id] ? { ...CUENTAS[where.id] } : null));
const emailFalso = (falla = false) => ({
  sendNotificationEmail: jest.fn(async () => {
    if (falla) throw new Error('No se pudo enviar el correo de notificación');
  }),
});

/** Casos de reautenticación comunes a POST, PUT y DELETE: [caso, usuario, passwordActual, mensaje, code]. */
const CASOS_REAUTENTICACION: [string, string, string | undefined, string, string][] = [
  ['cuenta con contraseña sin passwordActual', 'u-1', undefined, PASSWORD_REQUERIDA, 'PASSWORD_ACTUAL_REQUERIDA'],
  ['cuenta con contraseña y passwordActual vacía', 'u-1', '', PASSWORD_REQUERIDA, 'PASSWORD_ACTUAL_REQUERIDA'],
  ['contraseña incorrecta', 'u-1', 'OtraClaveFicticia-9', PASSWORD_INCORRECTA, 'PASSWORD_ACTUAL_INCORRECTA'],
  ['cuenta solo de Google (aunque mande una contraseña)', 'u-g', PASSWORD, CUENTA_GOOGLE, 'CUENTA_GOOGLE_SIN_PREGUNTA'],
];

/** 400 (nunca 401: la web cierra la sesión con un 401) con el mensaje y el code esperados. */
function esperaError400(e: BadRequestException, mensaje: string, code: string) {
  expect(e).toBeInstanceOf(BadRequestException);
  expect(e).not.toBeInstanceOf(UnauthorizedException);
  expect(e.getStatus()).toBe(400);
  expect(e.message).toBe(mensaje);
  expect(e.getResponse()).toMatchObject({ code });
}

describe('POST /pregunta-seguridad: guarda de verdad la pregunta del usuario autenticado (punto 15)', () => {
  const prismaConUpdate = () => ({
    usuario: {
      findUnique: cuentaPorId(),
      update: jest.fn(
        async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => data,
      ),
    },
  });

  it('guarda la respuesta hasheada con bcrypt (compare da true), nunca en claro, con el contrato de respuesta de antes', async () => {
    const prisma = prismaConUpdate();
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);

    const r = await servicio.crearPregunta('u-1', PREGUNTA, '  Firulais  ', PASSWORD);

    expect(prisma.usuario.update).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.usuario.update.mock.calls[0][0];
    expect(where).toEqual({ id: 'u-1' });
    expect(data.preguntaSeguridad).toBe(PREGUNTA);
    expect(String(data.respuestaSeguridad)).not.toContain('Firulais');
    // Mismo criterio que usuarios.service: trim + bcrypt; la verificación con la respuesta en claro funciona.
    await expect(bcrypt.compare('Firulais', String(data.respuestaSeguridad))).resolves.toBe(true);
    // Contrato de HEAD: mismo message y los campos pregunta, email y respuesta en data
    expect(r).toEqual({
      success: true,
      message: 'Las preguntas se crean al registrar usuarios',
      data: { pregunta: PREGUNTA, email: 'clienta@example.com', respuesta: '[hasheada]' },
    });
    expect(JSON.stringify(r)).not.toContain(PASSWORD);
  });

  it('"Por definir" se rechaza con 400 y no guarda nada', async () => {
    const prisma = prismaConUpdate();
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);
    const e = await errorDe(servicio.crearPregunta('u-1', PREGUNTA, ' por  definir ', PASSWORD));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getStatus()).toBe(400);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('sin respuesta (o vacía) responde 400 y no guarda', async () => {
    const prisma = prismaConUpdate();
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);
    for (const respuesta of [undefined, '', '   ']) {
      const e = await errorDe(servicio.crearPregunta('u-1', PREGUNTA, respuesta as any, PASSWORD));
      expect(e).toBeInstanceOf(BadRequestException);
    }
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it.each(CASOS_REAUTENTICACION)('%s: 400 en español y no guarda ni avisa', async (_caso, usuarioId, passwordActual, mensaje, code) => {
    const prisma = prismaConUpdate();
    const email = emailFalso();
    const servicio = new PreguntaSeguridadService(prisma as any, email as any);
    esperaError400(await errorDe(servicio.crearPregunta(usuarioId, PREGUNTA, 'Firulais', passwordActual)), mensaje, code);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    expect(email.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('avisa por correo a la cuenta (sin la pregunta ni la respuesta) y el log no lleva el correo ni la contraseña', async () => {
    const salidas: string[] = [];
    const capturar = (...a: unknown[]) => salidas.push(a.map(String).join(' '));
    const espias = [
      ...(['log', 'warn', 'error'] as const).map((m) => jest.spyOn(console, m).mockImplementation(capturar)),
      ...(['log', 'warn', 'error'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(capturar as any)),
    ];
    try {
      const email = emailFalso();
      const servicio = new PreguntaSeguridadService(prismaConUpdate() as any, email as any);
      await servicio.crearPregunta('u-1', PREGUNTA, 'Firulais', PASSWORD);
      expect(email.sendNotificationEmail).toHaveBeenCalledTimes(1);
      const [destino, asunto, html] = email.sendNotificationEmail.mock.calls[0] as unknown as [string, string, string];
      expect(destino).toBe('clienta@example.com');
      expect(asunto).toBe('Tu pregunta de seguridad cambió - Miru Franco');
      expect(html).toContain('hora del centro de México');
      expect(html).toMatch(/Si no fuiste tú/);
      expect(html).not.toContain(PREGUNTA);
      expect(html).not.toContain('Firulais');
      expect(salidas.join('\n')).not.toContain('clienta@example.com');
      expect(salidas.join('\n')).not.toContain(PASSWORD);
    } finally {
      espias.forEach((e) => e.mockRestore());
    }
  });

  it('si el aviso por correo falla, la pregunta queda guardada y responde igual', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const prisma = prismaConUpdate();
      const servicio = new PreguntaSeguridadService(prisma as any, emailFalso(true) as any);
      await expect(servicio.crearPregunta('u-1', PREGUNTA, 'Firulais', PASSWORD)).resolves.toMatchObject({ success: true });
      expect(prisma.usuario.update).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('PUT y DELETE /pregunta-seguridad/:id: catálogo preguntas_disponibles solo admin (punto 15)', () => {
  const prismaCatalogo = (existente: Record<string, unknown> | null) => ({
    usuario: { findUnique: cuentaPorId() },
    preguntaDisponible: {
      findUnique: jest.fn(async () => existente),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ activa: true, ...data })),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        pregunta: '¿Vieja?',
        activa: true,
        ...data,
      })),
    },
  });

  it('PUT renombra y puede desactivar una pregunta existente del catálogo', async () => {
    const prisma = prismaCatalogo({ id: 'p-1', pregunta: '¿Vieja?', activa: true });
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);
    const r = await servicio.actualizarPregunta('p-1', { pregunta: '¿Nueva?', activa: false, passwordActual: PASSWORD }, 'admin-1');
    expect(prisma.preguntaDisponible.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { pregunta: '¿Nueva?', activa: false },
    });
    expect(r).toMatchObject({ success: true, data: { id: 'p-1', pregunta: '¿Nueva?', activa: false } });
  });

  it('PUT con un id que no existe crea la pregunta del catálogo (exige el texto)', async () => {
    const prisma = prismaCatalogo(null);
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);

    const sinTexto = await errorDe(servicio.actualizarPregunta('p-nueva', { activa: true, passwordActual: PASSWORD }, 'admin-1'));
    expect(sinTexto).toBeInstanceOf(BadRequestException);

    const r = await servicio.actualizarPregunta('p-nueva', { pregunta: '¿Ciudad natal?', passwordActual: PASSWORD }, 'admin-1');
    expect(prisma.preguntaDisponible.create).toHaveBeenCalledWith({
      data: { id: 'p-nueva', pregunta: '¿Ciudad natal?', activa: true },
    });
    expect(r).toMatchObject({ success: true, data: { id: 'p-nueva', pregunta: '¿Ciudad natal?', activa: true } });
  });

  it('DELETE desactiva la pregunta del catálogo (soft delete) y con id inexistente responde 404', async () => {
    const prisma = prismaCatalogo({ id: 'p-1', pregunta: '¿Vieja?', activa: true });
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);
    const r = await servicio.eliminarPregunta('p-1', 'admin-1', PASSWORD);
    expect(prisma.preguntaDisponible.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { activa: false },
    });
    expect(r).toMatchObject({ success: true, data: { id: 'p-1', activa: false } });

    const vacio = new PreguntaSeguridadService(prismaCatalogo(null) as any, emailFalso() as any);
    const e = await vacio.eliminarPregunta('p-x', 'admin-1', PASSWORD).catch((x: unknown) => x);
    expect((e as { getStatus: () => number }).getStatus()).toBe(404);
  });

  it.each(CASOS_REAUTENTICACION)('PUT y DELETE, %s: 400 en español y el catálogo no cambia', async (_caso, usuarioId, passwordActual, mensaje, code) => {
    const prisma = prismaCatalogo({ id: 'p-1', pregunta: '¿Vieja?', activa: true });
    const servicio = new PreguntaSeguridadService(prisma as any, emailFalso() as any);
    esperaError400(await errorDe(servicio.actualizarPregunta('p-1', { pregunta: '¿Nueva?', passwordActual }, usuarioId)), mensaje, code);
    esperaError400(await errorDe(servicio.eliminarPregunta('p-1', usuarioId, passwordActual)), mensaje, code);
    expect(prisma.preguntaDisponible.update).not.toHaveBeenCalled();
    expect(prisma.preguntaDisponible.create).not.toHaveBeenCalled();
  });

  it('PUT y DELETE exigen rol admin (JwtAuthGuard + RolesGuard); POST solo exige sesión', () => {
    const put = PreguntaSeguridadController.prototype.actualizarPregunta;
    const del = PreguntaSeguridadController.prototype.eliminarPregunta;
    for (const handler of [put, del]) {
      expect(Reflect.getMetadata('roles', handler)).toEqual(['admin']);
      const guards: Array<{ name?: string }> = Reflect.getMetadata('__guards__', handler) ?? [];
      const nombres = guards.map((g) => g.name ?? g.constructor?.name);
      expect(nombres).toContain('JwtAuthGuard');
      expect(nombres).toContain('RolesGuard');
    }
    const post = PreguntaSeguridadController.prototype.crearPregunta;
    expect(Reflect.getMetadata('roles', post)).toBeUndefined();
    const guardsPost: Array<{ name?: string }> = Reflect.getMetadata('__guards__', post) ?? [];
    expect(guardsPost.map((g) => g.name ?? g.constructor?.name)).toContain('JwtAuthGuard');
  });

  it('POST, PUT y DELETE llevan límite de intentos (5 por minuto) después de la sesión, como las otras rutas que piden la contraseña', () => {
    for (const handler of [
      PreguntaSeguridadController.prototype.crearPregunta,
      PreguntaSeguridadController.prototype.actualizarPregunta,
      PreguntaSeguridadController.prototype.eliminarPregunta,
    ]) {
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      expect(guards[0]).toBe(JwtAuthGuard);
      const limite = guards.find((g) => g instanceof RateLimitGuard) as any;
      expect(limite).toBeDefined();
      expect(limite.maxRequests).toBe(5);
      expect(limite.windowMs).toBe(60000);
    }
  });
});

describe('Rutas POST, PUT y DELETE /api/pregunta-seguridad con passwordActual', () => {
  let app: INestApplication;
  let base: string;
  const servicio = { crearPregunta: jest.fn(), actualizarPregunta: jest.fn(), eliminarPregunta: jest.fn() };
  /** El JwtAuthGuard real necesita un JWT firmado; aquí la usuaria llega en un header de prueba. */
  const sesionFalsa: CanActivate = {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      req.user = { id: req.headers['x-usuaria'], rol: 'admin' };
      return true;
    },
  };
  const todos: CanActivate = { canActivate: () => true };
  const limpiarLimites = () => {
    for (const h of [
      PreguntaSeguridadController.prototype.crearPregunta,
      PreguntaSeguridadController.prototype.actualizarPregunta,
      PreguntaSeguridadController.prototype.eliminarPregunta,
    ]) {
      (Reflect.getMetadata(GUARDS_METADATA, h) ?? []).filter((g: unknown) => g instanceof RateLimitGuard).forEach((g: any) => g.requests.clear());
    }
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [PreguntaSeguridadController],
      providers: [{ provide: PreguntaSeguridadService, useValue: servicio }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesionFalsa)
      .overrideGuard(RolesGuard)
      .useValue(todos)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    limpiarLimites();
    servicio.crearPregunta.mockReset().mockResolvedValue({ success: true });
    servicio.actualizarPregunta.mockReset().mockResolvedValue({ success: true });
    servicio.eliminarPregunta.mockReset().mockResolvedValue({ success: true });
  });

  const pedir = (metodo: string, ruta: string, cuerpo: unknown) =>
    fetch(`${base}/api/pregunta-seguridad${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-usuaria': 'u-1' },
      body: JSON.stringify(cuerpo),
    });

  it('POST pasa la usuaria de la sesión, la pregunta, la respuesta y passwordActual al servicio', async () => {
    const r = await pedir('POST', '', { pregunta: PREGUNTA, respuesta: 'Firulais', passwordActual: PASSWORD });
    expect(r.status).toBe(201);
    expect(servicio.crearPregunta).toHaveBeenCalledWith('u-1', PREGUNTA, 'Firulais', PASSWORD);
  });

  it('PUT pasa passwordActual dentro de los datos y la usuaria de la sesión', async () => {
    const r = await pedir('PUT', '/p-1', { pregunta: '¿Nueva?', passwordActual: PASSWORD });
    expect(r.status).toBe(200);
    expect(servicio.actualizarPregunta).toHaveBeenCalledWith('p-1', { pregunta: '¿Nueva?', passwordActual: PASSWORD }, 'u-1');
  });

  it('DELETE lee passwordActual del cuerpo y pasa la usuaria de la sesión', async () => {
    const r = await pedir('DELETE', '/p-1', { passwordActual: PASSWORD });
    expect(r.status).toBe(200);
    expect(servicio.eliminarPregunta).toHaveBeenCalledWith('p-1', 'u-1', PASSWORD);
  });

  it.each([
    ['POST', '', { pregunta: PREGUNTA, respuesta: 'Firulais', passwordActual: 123 }],
    ['PUT', '/p-1', { pregunta: '¿Nueva?', passwordActual: 123 }],
    ['DELETE', '/p-1', { passwordActual: 123 }],
  ])('%s con passwordActual que no es texto: 400 en español sin llegar al servicio', async (metodo, ruta, cuerpo) => {
    const r = await pedir(metodo, ruta, cuerpo);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toContain('La contraseña actual debe ser texto.');
    expect(servicio.crearPregunta).not.toHaveBeenCalled();
    expect(servicio.actualizarPregunta).not.toHaveBeenCalled();
    expect(servicio.eliminarPregunta).not.toHaveBeenCalled();
  });

  it.each([
    ['POST sin pregunta', 'POST', '', { respuesta: 'Firulais', passwordActual: PASSWORD }, 'Escribe la pregunta de seguridad.'],
    ['POST con pregunta que no es texto', 'POST', '', { pregunta: 5, respuesta: 'Firulais', passwordActual: PASSWORD }, 'La pregunta de seguridad debe ser texto.'],
    ['POST con respuesta que no es texto', 'POST', '', { pregunta: PREGUNTA, respuesta: 5, passwordActual: PASSWORD }, 'La respuesta de seguridad debe ser texto.'],
    ['POST con correo inválido', 'POST', '', { pregunta: PREGUNTA, respuesta: 'Firulais', email: 'no-es-correo', passwordActual: PASSWORD }, 'Escribe un correo válido.'],
    ['PUT con pregunta que no es texto', 'PUT', '/p-1', { pregunta: 5, passwordActual: PASSWORD }, 'La pregunta de seguridad debe ser texto.'],
    ['PUT con activa que no es booleano', 'PUT', '/p-1', { activa: 'si', passwordActual: PASSWORD }, 'activa debe ser verdadero o falso.'],
  ])('%s: 400 con el mensaje en español', async (_caso, metodo, ruta, cuerpo, mensaje) => {
    const r = await pedir(metodo, ruta, cuerpo);
    expect(r.status).toBe(400);
    const texto = JSON.stringify(await r.json());
    expect(texto).toContain(mensaje);
    expect(texto).not.toMatch(/should not|must be/);
  });

  it('el 400 del servicio (contraseña incorrecta) llega con su mensaje y su code', async () => {
    servicio.crearPregunta.mockRejectedValueOnce(new BadRequestException({ message: PASSWORD_INCORRECTA, code: 'PASSWORD_ACTUAL_INCORRECTA' }));
    const r = await pedir('POST', '', { pregunta: PREGUNTA, respuesta: 'Firulais', passwordActual: 'OtraClaveFicticia-9' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ message: PASSWORD_INCORRECTA, code: 'PASSWORD_ACTUAL_INCORRECTA' });
  });
});

describe('POST /pregunta-seguridad/verificar: "Por definir" nunca vale', () => {
  it('cuenta guardada con la respuesta por defecto de admin: el mismo 400 genérico', async () => {
    const hash = await bcrypt.hash('Por definir', 4);
    const servicio = new PreguntaSeguridadService(
      prismaCon({ 'admin-creada@example.com': { id: 'u-9', activo: true, preguntaSeguridad: PREGUNTA, respuestaSeguridad: hash } }) as any,
    );
    const e = await errorDe(servicio.verificarRespuesta('admin-creada@example.com', { [PREGUNTA]: 'Por definir' }));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toBe(DATOS_NO_COINCIDEN);
  });
});
