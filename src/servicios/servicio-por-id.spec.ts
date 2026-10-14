import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';

/**
 * GET /api/servicios/:id es público: visitantes y clientas solo ven servicios activos (uno inactivo
 * responde 404 y no se puede reservar). El panel de edición del admin usa la misma ruta con sesión,
 * así que el personal con servicios:lectura sigue viendo los inactivos.
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'servicios:lectura', 'servicios:escritura'],
  becario: ['citas:asignadas', 'servicios:lectura'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};
const SERVICIOS: Record<number, { id: number; nombre: string; activo: boolean }> = {
  5: { id: 5, nombre: 'Corte', activo: true },
  96: { id: 96, nombre: 'Servicio QA edit', activo: false },
};

/** La sesión llega en un header de prueba (el JWT real se prueba en las rutas de auth). */
const sesionDePrueba = (opcional: boolean): CanActivate => ({
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) return opcional;
    req.user = { id };
    return true;
  },
});

describe('GET /api/servicios/:id', () => {
  let app: INestApplication;
  let base: string;
  const prisma: any = {
    servicio: { findUnique: jest.fn(async ({ where }: any) => SERVICIOS[where.id] ?? null) },
    usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id.replace(/-yo$/, '') })) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => ({ claves: CLAVES[where.rol] })) },
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [ServiciosController],
      providers: [ServiciosService, { provide: PrismaService, useValue: prisma }],
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
  afterAll(() => app.close());

  const pedir = async (id: string | number, usuaria?: string) => {
    const res = await fetch(`${base}/api/servicios/${id}`, { headers: usuaria ? { 'x-usuaria': usuaria } : {} });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  it('un servicio activo lo ve cualquiera', async () => {
    expect(await pedir(5)).toMatchObject({ status: 200, body: { data: { id: 5 } } });
    expect(await pedir(5, 'cliente-yo')).toMatchObject({ status: 200 });
  });

  it.each([
    ['un visitante', undefined],
    ['una clienta', 'cliente-yo'],
  ])('un servicio inactivo responde 404 a %s', async (_quien, usuaria) => {
    const r = await pedir(96, usuaria);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe('Servicio no encontrado');
  });

  it.each(['admin-yo', 'estilista-yo', 'becario-yo'])('el personal con servicios:lectura (%s) sí ve el inactivo para editarlo', async (usuaria) => {
    expect(await pedir(96, usuaria)).toMatchObject({ status: 200, body: { data: { id: 96, activo: false } } });
  });

  it('un servicio que no existe responde 404 también al admin', async () => {
    expect((await pedir(4040, 'admin-yo')).status).toBe(404);
  });

  it('un id no numérico responde 400 "Id inválido" (no 500)', async () => {
    const r = await pedir('abc');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Id inválido');
  });
});
