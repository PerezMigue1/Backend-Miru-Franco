import { Prisma } from '@prisma/client';
import { ServiciosService } from './servicios.service';

/**
 * La web decidía con el monto del servicio si anunciar un anticipo, pero el backend solo lo pide si además está
 * configurada ANTICIPOS_DESDE (CitasService.crear): en desarrollo anunciaba $75, registraba el consentimiento y
 * la cita se creaba sin anticipo. GET /servicios y /servicios/:id traen `anticipoAplica`, con la misma regla que
 * la creación de la cita en línea, sin tocar `anticipoMonto` (el panel lo usa para editar).
 */
const servicio = (extra: Record<string, unknown> = {}) => ({ id: 5, nombre: 'Nanoplastia', activo: true, anticipoMonto: new Prisma.Decimal(75), ...extra });

function montar(filas: any[]) {
  const prisma: any = {
    servicio: {
      findMany: jest.fn(async () => filas),
      findUnique: jest.fn(async ({ where }: any) => filas.find((s) => s.id === where.id) ?? null),
    },
  };
  return new ServiciosService(prisma);
}

describe('anticipoAplica en la respuesta pública de servicios', () => {
  const original = process.env.ANTICIPOS_DESDE;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTICIPOS_DESDE;
    else process.env.ANTICIPOS_DESDE = original;
  });

  it('sin ANTICIPOS_DESDE: el servicio con monto NO aplica anticipo (la cita se crearía sin él); el monto sigue igual', async () => {
    delete process.env.ANTICIPOS_DESDE;
    const srv = montar([servicio()]);
    const lista = await srv.listar();
    expect(lista.data[0]).toMatchObject({ anticipoAplica: false });
    expect(String(lista.data[0].anticipoMonto)).toBe('75');
    const uno = await srv.obtenerPorId(5);
    expect(uno.data).toMatchObject({ anticipoAplica: false });
    expect(String(uno.data.anticipoMonto)).toBe('75');
  });

  it('con ANTICIPOS_DESDE: aplica si el servicio tiene monto; sin monto o en 0, no', async () => {
    process.env.ANTICIPOS_DESDE = '2026-10-01';
    const srv = montar([servicio(), servicio({ id: 6, anticipoMonto: null }), servicio({ id: 7, anticipoMonto: new Prisma.Decimal(0) })]);
    const lista = await srv.listar();
    expect(lista.data.map((s: any) => [s.id, s.anticipoAplica])).toEqual([[5, true], [6, false], [7, false]]);
    expect((await srv.obtenerPorId(5)).data).toMatchObject({ anticipoAplica: true });
    expect((await srv.obtenerPorId(6)).data).toMatchObject({ anticipoAplica: false });
  });

  it('un ANTICIPOS_DESDE inválido cuenta como no configurado, igual que al crear la cita', async () => {
    process.env.ANTICIPOS_DESDE = '2026-02-30';
    expect((await montar([servicio()]).obtenerPorId(5)).data).toMatchObject({ anticipoAplica: false });
  });
});
