import { ModeloClusteringService } from './modelo-clustering.service';
import { SegmentacionClientesService } from './segmentacion-clientes.service';

describe('SegmentacionClientesService', () => {
  it('calcula las siete variables desde pedidos y ventas locales', async () => {
    const prisma = {
      usuario: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cliente-1',
          nombre: 'Cliente de prueba',
          email: 'cliente@miru.test',
          activo: true,
        }),
      },
      pedido: {
        findMany: jest.fn().mockResolvedValue([
          {
            usuarioId: 'cliente-1',
            total: 800,
            creadoEn: new Date(),
            items: [{ cantidad: 2 }],
          },
        ]),
      },
      ventaLocal: {
        findMany: jest.fn().mockResolvedValue([
          {
            clienteId: 'cliente-1',
            total: 700,
            creadoEn: new Date(),
            items: [
              { cantidad: 1, presentacionId: 4, servicioId: null },
              { cantidad: 1, presentacionId: null, servicioId: 2 },
            ],
          },
        ]),
      },
    };
    const modelo = new ModeloClusteringService();
    modelo.onModuleInit();
    const servicio = new SegmentacionClientesService(prisma as never, modelo);

    const resultado = await servicio.segmentarCliente('cliente-1');

    expect(resultado.datosOrigen).toMatchObject({
      comprasOnline: 1,
      comprasLocales: 1,
      productosOnline: 2,
      productosLocales: 1,
      serviciosComprados: 1,
      gastoOnline: 800,
      gastoLocal: 700,
    });
    expect(resultado.variables).toMatchObject({
      frecuencia_total: 2,
      productos_totales: 3,
      servicios_comprados: 1,
      gasto_total: 1500,
      ticket_promedio: 750,
      recencia_dias: 0,
    });
    expect(resultado.segmento).toBe('Recientes de consumo bajo');
  });
});
