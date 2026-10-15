import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';

/**
 * Borrado lógico de productos: DELETE pone activo=false (pedidos y ventas pasadas no se tocan).
 * GET /api/productos y GET /api/productos/:id son públicos y solo muestran activos; el admin y el
 * personal con servicios:escritura ven también los inactivos (con ?incluirInactivos=1 en el listado).
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'servicios:lectura', 'servicios:escritura'],
  becario: ['citas:asignadas', 'servicios:lectura'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};

type Fila = { id: number; nombre: string; activo: boolean; presentaciones: unknown[] };

function prismaFalso() {
  const filas = new Map<number, Fila>([
    [1, { id: 1, nombre: 'Shampoo', activo: true, presentaciones: [] }],
    [2, { id: 2, nombre: 'Producto QA viejo', activo: false, presentaciones: [] }],
  ]);
  const prisma: any = {
    producto: {
      findMany: jest.fn(async ({ where }: any) =>
        [...filas.values()].filter((f) => where?.activo === undefined || f.activo === where.activo),
      ),
      findUnique: jest.fn(async ({ where }: any) => (filas.has(where.id) ? { ...filas.get(where.id)! } : null)),
      update: jest.fn(async ({ where, data }: any) => {
        const fila = { ...filas.get(where.id)!, ...data };
        filas.set(where.id, fila);
        return fila;
      }),
      delete: jest.fn(async () => {
        throw new Error('No debe borrarse físicamente');
      }),
    },
    usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id.replace(/-yo$/, '') })) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => ({ claves: CLAVES[where.rol] ?? [] })) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, filas };
}

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

describe('Productos: borrado lógico con activo', () => {
  let app: INestApplication;
  let base: string;
  let db: ReturnType<typeof prismaFalso>;

  let consola: jest.SpyInstance;

  beforeAll(async () => {
    consola = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    db = prismaFalso();
    const modulo = await Test.createTestingModule({
      controllers: [ProductosController],
      providers: [ProductosService, { provide: PrismaService, useFactory: () => db.prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesionDePrueba(false))
      .overrideGuard(SesionOpcionalGuard)
      .useValue(sesionDePrueba(true))
      .overrideGuard(PermisosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    consola.mockRestore();
  });

  beforeEach(() => {
    const nuevo = prismaFalso();
    db.filas.clear();
    nuevo.filas.forEach((v, k) => db.filas.set(k, v));
    jest.clearAllMocks();
  });

  const pedir = async (metodo: string, ruta: string, usuaria?: string, cuerpo?: unknown) => {
    const res = await fetch(`${base}/api/productos${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(usuaria ? { 'x-usuaria': usuaria } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const ids = (body: Record<string, any>) => (body.data as Fila[]).map((p) => p.id);

  describe('DELETE /api/productos/:id', () => {
    it('pone activo=false, no borra la fila y responde con el mismo contrato', async () => {
      const r = await pedir('DELETE', '/1', 'admin-yo');
      expect(r).toEqual({ status: 200, body: { success: true, message: 'Producto eliminado correctamente' } });
      expect(db.prisma.producto.delete).not.toHaveBeenCalled();
      expect(db.prisma.producto.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { activo: false } });
      expect(db.filas.get(1)?.activo).toBe(false);
    });

    it('un producto que no existe sigue respondiendo 404', async () => {
      const r = await pedir('DELETE', '/404', 'admin-yo');
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('Producto no encontrado');
    });
  });

  describe('GET /api/productos', () => {
    it('por defecto solo devuelve los activos (visitante, clienta y admin)', async () => {
      for (const usuaria of [undefined, 'cliente-yo', 'admin-yo']) {
        const r = await pedir('GET', '', usuaria);
        expect(r.status).toBe(200);
        expect(ids(r.body)).toEqual([1]);
      }
    });

    it.each(['admin-yo', 'estilista-yo'])('con incluirInactivos=1, %s (admin o servicios:escritura) ve también los inactivos', async (usuaria) => {
      const r = await pedir('GET', '?incluirInactivos=1', usuaria);
      expect(r.status).toBe(200);
      expect(ids(r.body)).toEqual([1, 2]);
      expect(r.body.count).toBe(2);
    });

    it.each([
      ['un visitante', undefined],
      ['una clienta', 'cliente-yo'],
      ['servicios:lectura sin escritura', 'becario-yo'],
    ])('con incluirInactivos=1, %s solo recibe los activos', async (_quien, usuaria) => {
      const r = await pedir('GET', '?incluirInactivos=1', usuaria);
      expect(r.status).toBe(200);
      expect(ids(r.body)).toEqual([1]);
    });
  });

  describe('GET /api/productos/:id', () => {
    it.each([
      ['un visitante', undefined],
      ['una clienta', 'cliente-yo'],
      ['servicios:lectura sin escritura', 'becario-yo'],
    ])('un producto inactivo responde 404 a %s', async (_quien, usuaria) => {
      const r = await pedir('GET', '/2', usuaria);
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('Producto no encontrado');
    });

    it.each(['admin-yo', 'estilista-yo'])('%s sí ve el inactivo para editarlo o reactivarlo', async (usuaria) => {
      expect(await pedir('GET', '/2', usuaria)).toMatchObject({ status: 200, body: { data: { id: 2, activo: false } } });
    });

    it('un producto activo lo ve cualquiera', async () => {
      expect(await pedir('GET', '/1')).toMatchObject({ status: 200, body: { data: { id: 1, activo: true } } });
    });
  });

  describe('PUT /api/productos/:id', () => {
    it('acepta activo=true y reactiva el producto', async () => {
      const r = await pedir('PUT', '/2', 'admin-yo', { activo: true });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ id: 2, activo: true });
      expect(db.filas.get(2)?.activo).toBe(true);
    });
  });
});
