import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';

/** Prisma en memoria: guarda lo que recibe `create` y lo devuelve en `findUnique`, como la base. */
function prismaEnMemoria() {
  const filas = new Map<number, any>();
  let siguienteId = 1;
  return {
    producto: {
      create: jest.fn(async ({ data }: { data: any }) => {
        const id = siguienteId++;
        const { presentaciones, ...resto } = data;
        const fila = {
          id,
          activo: true, // DEFAULT true de la columna
          ...resto,
          presentaciones: (presentaciones?.create ?? []).map((p: any, i: number) => ({ id: i + 1, productoId: id, ...p })),
        };
        filas.set(id, structuredClone(fila));
        return structuredClone(fila);
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => structuredClone(filas.get(where.id) ?? null)),
    },
  };
}

describe('ProductosService: los datos se guardan tal cual', () => {
  const URL_CLOUDINARY =
    'https://res.cloudinary.com/miru-franco/image/upload/v1727712000/productos/fluido-di-goji_800x800.webp';

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('una URL de Cloudinary de una presentación se lee idéntica a como se guardó', async () => {
    // La imagen llega como subida propia de productos/ y el servidor la cambia por su URL de Cloudinary.
    const subidas = { resolverImagenes: jest.fn(async () => [URL_CLOUDINARY]) };
    const servicio = new ProductosService(prismaEnMemoria() as any, subidas as any);

    const { data: creado } = await servicio.crear({
      nombre: 'Fluido Di Goji',
      marca: 'AVYNA',
      presentaciones: [{ tamanio: '100 ml', imagenes: ['productos/panel_' + '0'.repeat(32)], precio: 535, stock: 10 }],
    } as any, 'u-1');
    const { data: leido } = await servicio.obtenerPorId(creado.id);

    expect(leido.presentaciones[0].imagenes).toEqual([URL_CLOUDINARY]);
    expect(leido.presentaciones[0].imagenes[0]).not.toContain('&#x2F;');
  });

  it('las comillas y apóstrofos del texto no se convierten en entidades HTML', async () => {
    const servicio = new ProductosService(prismaEnMemoria() as any);
    const ingredientes = `Aceite de goji "prensado en frío", vitamina E y extracto de d'Argan`;

    const { data: creado } = await servicio.crear({ nombre: 'Fluido Di Goji', marca: 'AVYNA', ingredientes } as any);
    const { data: leido } = await servicio.obtenerPorId(creado.id);

    expect(leido.ingredientes).toBe(ingredientes);
  });
});

describe('/api/productos/:id: un id que no es número responde 400, no 500', () => {
  let app: INestApplication;
  let base: string;
  const productos = {
    obtenerPorId: jest.fn(async () => ({ success: true })),
    actualizar: jest.fn(async () => ({ success: true })),
    eliminar: jest.fn(async () => ({ success: true })),
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [ProductosController],
      providers: [{ provide: ProductosService, useValue: productos }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermisosGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SesionOpcionalGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const pedir = (metodo: string, id: string) =>
    fetch(`${base}/api/productos/${id}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: metodo === 'PUT' ? JSON.stringify({ nombre: 'Shampoo' }) : undefined,
    });

  it.each(['GET', 'PUT', 'DELETE'])('%s con id "abc": 400 "Id inválido" y el servicio no se llama', async (metodo) => {
    const res = await pedir(metodo, 'abc');
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Id inválido');
    expect(productos.obtenerPorId).not.toHaveBeenCalled();
    expect(productos.actualizar).not.toHaveBeenCalled();
    expect(productos.eliminar).not.toHaveBeenCalled();
  });

  it('con un id numérico llega como número al servicio', async () => {
    expect((await pedir('GET', '5')).status).toBe(200);
    expect(productos.obtenerPorId).toHaveBeenCalledWith(5, undefined);
    expect((await pedir('DELETE', '5')).status).toBe(200);
    expect(productos.eliminar).toHaveBeenCalledWith(5);
  });
});
