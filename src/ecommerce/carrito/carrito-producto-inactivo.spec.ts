import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CarritoService } from './carrito.service';

/**
 * Carrito: un producto desactivado (borrado lógico, productos.activo=false) ya no entra al carrito.
 * Agregar o actualizar un artículo suyo responde 400 en español; eliminarlo sigue permitido.
 * Al listar, sus artículos se excluyen: la clienta no ve totales con algo que ya no puede comprar y el
 * checkout no le falla por ellos (validarItems también los rechaza).
 *
 * El doble de Prisma solo devuelve `producto` cuando la consulta lo pide (include/select), igual que la
 * base real: así la prueba falla si el servicio deja de preguntar por `producto.activo`.
 */
const CLIENTA = 'clienta-1';
const OTRA = 'clienta-2';
const MENSAJE = 'Este producto ya no está disponible';

type Fila = { id: number; usuarioId: string; activo: boolean; presentacionId: number; producto: { activo: boolean } };

function pideProducto(args: any): boolean {
  return Boolean(args?.include?.producto || args?.select?.producto);
}

function montar(opciones: { productoActivo: boolean; duenaItem?: string; filas?: Fila[] }) {
  const producto = { id: 3, nombre: 'Shampoo', activo: opciones.productoActivo };
  const presentacion = { id: 1, productoId: 3, disponible: true, stock: 10, precio: 120 };
  const item = { id: 50, usuarioId: opciones.duenaItem ?? CLIENTA, productoId: 3, presentacionId: 1, cantidad: 1, activo: true };
  const prisma: any = {
    usuario: { findUnique: jest.fn(async () => ({ rol: 'cliente' })) },
    productoPresentacion: {
      findUnique: jest.fn(async (args: any) => (pideProducto(args) ? { ...presentacion, producto } : { ...presentacion })),
    },
    carritoItem: {
      findUnique: jest.fn(async (args: any) => (pideProducto(args) ? { ...item, producto } : { ...item })),
      findMany: jest.fn(async ({ where }: any) =>
        (opciones.filas ?? []).filter(
          (f) =>
            f.usuarioId === where.usuarioId &&
            (where.activo === undefined || f.activo === where.activo) &&
            (where.producto?.activo === undefined || f.producto.activo === where.producto.activo),
        ),
      ),
      upsert: jest.fn(async ({ create }: any) => ({ id: 50, ...create })),
      update: jest.fn(async ({ data }: any) => ({ ...item, ...data })),
      delete: jest.fn(async () => item),
    },
  };
  const access = new EcommerceAccessService(prisma);
  const carrito = new CarritoService(prisma, access);
  return { carrito, prisma };
}

describe('Carrito: agregar un producto inactivo', () => {
  it('responde 400 en español y no guarda el artículo', async () => {
    const { carrito, prisma } = montar({ productoActivo: false });
    await expect(carrito.upsert(CLIENTA, { productoId: 3, presentacionId: 1, cantidad: 1 })).rejects.toMatchObject({
      status: 400,
      message: MENSAJE,
    });
    expect(prisma.carritoItem.upsert).not.toHaveBeenCalled();
  });

  it('un producto activo se sigue agregando', async () => {
    const { carrito, prisma } = montar({ productoActivo: true });
    await expect(carrito.upsert(CLIENTA, { productoId: 3, presentacionId: 1, cantidad: 2 })).resolves.toMatchObject({ success: true });
    expect(prisma.carritoItem.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('Carrito: actualizar un artículo de un producto inactivo', () => {
  it('cambiar la cantidad responde 400 en español y no actualiza', async () => {
    const { carrito, prisma } = montar({ productoActivo: false });
    await expect(carrito.actualizar(50, CLIENTA, { cantidad: 2 })).rejects.toMatchObject({ status: 400, message: MENSAJE });
    expect(prisma.carritoItem.update).not.toHaveBeenCalled();
  });

  it('reactivar el artículo también responde 400', async () => {
    const { carrito, prisma } = montar({ productoActivo: false });
    await expect(carrito.actualizar(50, CLIENTA, { activo: true })).rejects.toMatchObject({ status: 400, message: MENSAJE });
    expect(prisma.carritoItem.update).not.toHaveBeenCalled();
  });

  it('el artículo de otra clienta sigue respondiendo 403 antes de revisar el producto', async () => {
    const { carrito } = montar({ productoActivo: false, duenaItem: OTRA });
    await expect(carrito.actualizar(50, CLIENTA, { cantidad: 2 })).rejects.toMatchObject({ status: 403 });
  });

  it('un producto activo se sigue actualizando', async () => {
    const { carrito, prisma } = montar({ productoActivo: true });
    await expect(carrito.actualizar(50, CLIENTA, { cantidad: 2 })).resolves.toMatchObject({ success: true });
    expect(prisma.carritoItem.update).toHaveBeenCalledTimes(1);
  });

  it('eliminarlo sigue permitido', async () => {
    const { carrito, prisma } = montar({ productoActivo: false });
    await expect(carrito.eliminar(50, CLIENTA)).resolves.toMatchObject({ success: true });
    expect(prisma.carritoItem.delete).toHaveBeenCalledTimes(1);
  });
});

describe('Carrito: listar excluye los artículos de productos inactivos', () => {
  it('solo devuelve artículos de productos activos y el conteo cuadra', async () => {
    const filas: Fila[] = [
      { id: 1, usuarioId: CLIENTA, activo: true, presentacionId: 1, producto: { activo: true } },
      { id: 2, usuarioId: CLIENTA, activo: true, presentacionId: 2, producto: { activo: false } },
    ];
    const { carrito } = montar({ productoActivo: true, filas });
    const res = await carrito.listar(CLIENTA);
    expect(res.data.map((f: { id: number }) => f.id)).toEqual([1]);
    expect(res.count).toBe(1);
  });
});
