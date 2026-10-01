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
    const servicio = new ProductosService(prismaEnMemoria() as any);

    const { data: creado } = await servicio.crear({
      nombre: 'Fluido Di Goji',
      marca: 'AVYNA',
      presentaciones: [{ tamanio: '100 ml', imagenes: [URL_CLOUDINARY], precio: 535, stock: 10 }],
    } as any);
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
