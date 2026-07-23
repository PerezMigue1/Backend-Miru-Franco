import { ModeloCancelacionService } from './modelo-cancelacion.service';

describe('ModeloCancelacionService', () => {
  it('reproduce el caso de despliegue de la libreta', () => {
    const servicio = new ModeloCancelacionService();
    servicio.onModuleInit();

    const resultado = servicio.predecir({
      dias_anticipacion: 7,
      hora_cita: 10.5,
      mes_cita: 8,
      es_fin_semana: 0,
      citas_previas_cliente: 2,
      cancelaciones_previas_cliente: 1,
      completadas_previas_cliente: 1,
      tasa_cancelacion_cliente: 0.5,
      cliente_nuevo: 0,
      antiguedad_cliente_dias: 180,
      precio_servicio: 850,
      duracion_servicio: 90,
      requiere_evaluacion: 1,
      dia_semana: 'viernes',
      franja_horaria: 'manana',
      servicio_id: '5',
      categoria_servicio: 'Tratamientos Capilares',
      especialista_id: '5f52565a-4ea0-4850-aabb-ab4cc4044171',
    });

    expect(resultado.probabilidadCancelacion).toBeCloseTo(0.4516, 4);
    expect(resultado.prediccionCancelada).toBe(true);
    expect(resultado.nivelRiesgo).toBe('alto');
    expect(resultado.modelo.algoritmo).toBe('Random Forest');
  });
});
