import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { firmarParametrosCloudinary } from './firma-cloudinary';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

/** POST /api/subidas/firma: firma de Cloudinary para galería (personal) y facturas (solo admin). */

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SubidasController } = require('./subidas.controller');

// Valores falsos: nunca se llama a la API de Cloudinary.
const SECRETO = 'secreto-falso-de-prueba';
const VARIABLES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
const originales = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));

/** El JwtAuthGuard real necesita un JWT firmado; aquí la persona llega en headers de prueba. */
const guardFalso: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) throw new UnauthorizedException();
    req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
    return true;
  },
};

describe('POST /api/subidas/firma', () => {
  let app: INestApplication;
  let base: string;
  // RolesGuard lee el rol de BD: aquí la "BD" responde el rol que trae el header de prueba.
  const roles = new Map<string, string>();
  const prisma = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (roles.has(where.id) ? { rol: roles.get(where.id) } : null)) },
  };

  beforeAll(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'nube-de-prueba';
    process.env.CLOUDINARY_API_KEY = '000000000000000';
    process.env.CLOUDINARY_API_SECRET = SECRETO;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const modulo = await Test.createTestingModule({
      controllers: [SubidasController],
      providers: [{ provide: PrismaService, useValue: prisma }],
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
    // Se vacía el contador del límite para no depender de las solicitudes de otras pruebas.
    Reflect.getMetadata(GUARDS_METADATA, SubidasController.prototype.firma)
      .find((g: unknown) => g instanceof RateLimitGuard)
      .requests.clear();
  });

  afterAll(async () => {
    await app.close();
    for (const v of VARIABLES) {
      if (originales[v] === undefined) delete process.env[v];
      else process.env[v] = originales[v];
    }
    jest.restoreAllMocks();
  });

  const pedir = (cuerpo: unknown, rol: string | null) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (rol) {
      const id = `persona-${rol}`;
      roles.set(id, rol);
      headers['x-usuaria'] = id;
      headers['x-rol'] = rol;
    }
    return fetch(`${base}/api/subidas/firma`, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
  };

  it('exige sesión, rol y límite holgado de solicitudes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SubidasController.prototype.firma);
    expect(guards[0]).toBe(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    const limite = guards.find((g: unknown) => g instanceof RateLimitGuard);
    expect(limite.maxRequests).toBe(30);
    expect(limite.windowMs).toBe(60000);
  });

  it('está registrado en AuthModule', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuthModule } = require('./auth.module');
    expect(Reflect.getMetadata('controllers', AuthModule)).toContain(SubidasController);
  });

  it('sin sesión: 401', async () => {
    expect((await pedir({ uso: 'galeria' }, null)).status).toBe(401);
  });

  it('clienta pidiendo galería: 403', async () => {
    expect((await pedir({ uso: 'galeria' }, 'cliente')).status).toBe(403);
  });

  it.each(['estilista', 'empleado', 'becario'])('%s pidiendo factura: 403', async (rol) => {
    expect((await pedir({ uso: 'factura' }, rol)).status).toBe(403);
  });

  it.each(['admin', 'estilista', 'empleado', 'becario'])('%s pidiendo galería: firma de la carpeta galeria', async (rol) => {
    const res = await pedir({ uso: 'galeria' }, rol);
    const texto = await res.text();
    expect(res.status).toBe(200);
    expect(texto).not.toContain(SECRETO);
    const { data } = JSON.parse(texto);
    expect(data.params.folder).toBe('galeria');
    expect(data.params.public_id).toBeUndefined();
    expect(data.signature).toBe(firmarParametrosCloudinary(data.params, SECRETO));
  });

  it('admin pidiendo factura: firma de la carpeta facturas solo para PDF', async () => {
    const res = await pedir({ uso: 'factura' }, 'admin');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.params).toMatchObject({ folder: 'facturas', allowed_formats: 'pdf' });
  });

  it.each([{ uso: 'perfil' }, { uso: 'otra' }, {}, { uso: 'galeria', folder: 'avatares' }])(
    'cuerpo inválido %j: 400',
    async (cuerpo) => {
      expect((await pedir(cuerpo, 'admin')).status).toBe(400);
    },
  );

  it('a la solicitud 31 dentro de un minuto responde 429', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 31; i++) estados.push((await pedir({ uso: 'galeria' }, 'admin')).status);
    expect(estados).toEqual([...Array(30).fill(200), 429]);
  });
});
