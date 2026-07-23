import { ModeloClusteringService } from './modelo-clustering.service';

describe('ModeloClusteringService', () => {
  const servicio = new ModeloClusteringService();

  beforeAll(() => servicio.onModuleInit());

  it.each([
    [
      'cuenta sin compras',
      {
        frecuencia_total: 0,
        productos_totales: 0,
        servicios_comprados: 0,
        gasto_total: 0,
        ticket_promedio: 0,
        proporcion_online: 0,
        recencia_dias: 354,
      },
      1,
      'Sin compras registradas',
    ],
    [
      'compra reciente de bajo consumo',
      {
        frecuencia_total: 1,
        productos_totales: 2,
        servicios_comprados: 0,
        gasto_total: 750,
        ticket_promedio: 750,
        proporcion_online: 0,
        recencia_dias: 12,
      },
      0,
      'Recientes de consumo bajo',
    ],
    [
      'cliente ocasional',
      {
        frecuencia_total: 4,
        productos_totales: 7,
        servicios_comprados: 2,
        gasto_total: 3400,
        ticket_promedio: 850,
        proporcion_online: 1800 / 3400,
        recencia_dias: 80,
      },
      3,
      'Clientes ocasionales por reactivar',
    ],
    [
      'cliente frecuente',
      {
        frecuencia_total: 15,
        productos_totales: 63,
        servicios_comprados: 10,
        gasto_total: 27000,
        ticket_promedio: 1800,
        proporcion_online: 2 / 3,
        recencia_dias: 8,
      },
      2,
      'Frecuentes de alto valor',
    ],
  ])('reproduce el segmento de %s', (_caso, variables, cluster, segmento) => {
    const resultado = servicio.predecir(variables);
    expect(resultado.cluster).toBe(cluster);
    expect(resultado.segmento).toBe(segmento);
    expect(resultado.modelo.algoritmo).toBe('K-Means');
  });
});
