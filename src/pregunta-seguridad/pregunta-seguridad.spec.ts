import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import type { AddressInfo } from 'node:net';
import { DATOS_NO_COINCIDEN, SIN_PREGUNTA_RECUPERACION } from '../usuarios/usuarios.service';

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
      providers: [PreguntaSeguridadService, { provide: PrismaService, useValue: prismaCon(await usuariosDePrueba()) }],
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
