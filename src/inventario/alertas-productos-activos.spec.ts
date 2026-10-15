import { InventarioService } from './inventario.service';

/**
 * Alertas de inventario (stock bajo y caducidad): un producto desactivado (productos.activo = false)
 * ya no se vende ni se lista, así que tampoco debe salir en las alertas.
 * Prisma va simulado: se revisa el filtro que recibe la consulta y se aplica a datos de prueba.
 */
type Fila = { id: number; stock: number; fechaCaducidad: Date | null; producto: { id: number; activo: boolean } };

const FILAS: Fila[] = [
  { id: 1, stock: 2, fechaCaducidad: new Date('2026-10-20T12:00:00.000Z'), producto: { id: 10, activo: true } },
  { id: 2, stock: 1, fechaCaducidad: new Date('2026-10-18T12:00:00.000Z'), producto: { id: 20, activo: false } },
];

/** Aplica el `where` de Prisma que usa el servicio (stock, caducidad y producto.activo). */
function cumple(fila: Fila, where: any): boolean {
  if (where?.stock?.lte !== undefined && !(fila.stock <= where.stock.lte)) return false;
  if (where?.fechaCaducidad?.lte !== undefined && !(fila.fechaCaducidad && fila.fechaCaducidad <= where.fechaCaducidad.lte)) return false;
  if (where?.producto?.activo !== undefined && fila.producto.activo !== where.producto.activo) return false;
  if (where?.producto?.is?.activo !== undefined && fila.producto.activo !== where.producto.is.activo) return false;
  return true;
}

function servicio() {
  const findMany = jest.fn(async ({ where }: any) =>
    FILAS.filter((f) => cumple(f, where)).map((f) => ({ ...f, tamanio: '1L', disponible: true })),
  );
  return { findMany, s: new InventarioService({ productoPresentacion: { findMany } } as any) };
}

describe('Alertas de inventario: solo productos activos', () => {
  afterEach(() => jest.useRealTimers());

  it('stock bajo: el producto desactivado no aparece aunque tenga poco stock', async () => {
    const { findMany, s } = servicio();
    const res = await s.alertasStock({ umbral: 5 } as any);
    expect(res.data.map((p: any) => p.id)).toEqual([1]);
    expect(res.count).toBe(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ producto: { activo: true } });
  });

  it('caducidad: el producto desactivado no aparece aunque esté por caducar', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-14T16:00:00.000Z') });
    const { findMany, s } = servicio();
    const res = await s.caducidades({ dias: 30 } as any);
    expect(res.data.map((p: any) => p.id)).toEqual([1]);
    expect(res.count).toBe(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ producto: { activo: true } });
  });
});
