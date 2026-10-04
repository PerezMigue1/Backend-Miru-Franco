import { RiesgoCancelacionService } from './riesgo-cancelacion.service';

describe('RiesgoCancelacionService', () => {
  it('construye las variables previas a la cita sin fuga de información', async () => {
    const creadoEn = new Date('2026-08-07T16:30:00.000Z');
    const inicio = new Date('2026-08-14T16:30:00.000Z');
    const clienteCreadoEn = new Date('2026-02-08T16:30:00.000Z');

    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 99,
          clienteId: 'cliente-1',
          especialistaId: 'especialista-1',
          fechaHoraInicio: inicio,
          creadoEn,
          cliente: { creadoEn: clienteCreadoEn },
          servicio: {
            id: 5,
            categoria: 'Tratamientos Capilares',
            precio: 850,
            duracionMinutos: 90,
            requiereEvaluacion: true,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          clienteId: 'cliente-1',
          estado: 'cancelada',
          fechaHoraFin: new Date('2026-06-01T18:00:00.000Z'),
        },
        {
          id: 2,
          clienteId: 'cliente-1',
          estado: 'completada',
          fechaHoraFin: new Date('2026-07-01T18:00:00.000Z'),
        },
      ]);

    const prisma = { cita: { findMany } } as any;
    const predecir = jest.fn().mockReturnValue({
      probabilidadCancelacion: 0.4516,
      porcentajeCancelacion: 45.2,
      prediccionCancelada: true,
      prediccion: 'cancelada',
      nivelRiesgo: 'alto',
      accionSugerida: 'Realizar confirmación prioritaria por el personal.',
      modelo: {
        nombre: 'clasificacion_cancelacion_citas',
        algoritmo: 'Random Forest',
        umbral: 0.356,
        filasEntrenamiento: 3964,
      },
    });
    const modelo = { predecir } as any;

    const servicio = new RiesgoCancelacionService(prisma, modelo);
    const resultado = await servicio.predecirLote([99]);

    expect(resultado).toHaveLength(1);
    expect(resultado[0].citaId).toBe(99);
    expect(predecir).toHaveBeenCalledWith(
      expect.objectContaining({
        dias_anticipacion: 7,
        dia_semana: 'viernes',
        hora_cita: 10.5,
        franja_horaria: 'manana',
        mes_cita: 8,
        es_fin_semana: 0,
        citas_previas_cliente: 2,
        cancelaciones_previas_cliente: 1,
        completadas_previas_cliente: 1,
        tasa_cancelacion_cliente: 0.5,
        cliente_nuevo: 0,
        antiguedad_cliente_dias: 180,
        servicio_id: '5',
        precio_servicio: 850,
        duracion_servicio: 90,
        requiere_evaluacion: 1,
        especialista_id: 'especialista-1',
      }),
    );
  });

  it('una cita sin clienta registrada (sin cita) no rompe el lote: cuenta como clienta nueva', async () => {
    const creadoEn = new Date('2026-10-04T16:00:00.000Z');
    const findMany = jest.fn()
      .mockResolvedValueOnce([
        {
          id: 50, clienteId: null, especialistaId: 'esp-1', fechaHoraInicio: creadoEn, creadoEn, cliente: null,
          servicio: { id: 5, categoria: 'Corte', precio: 200, duracionMinutos: 30, requiereEvaluacion: false },
        },
        {
          id: 51, clienteId: null, especialistaId: 'esp-1', fechaHoraInicio: creadoEn, creadoEn, cliente: null,
          servicio: { id: 5, categoria: 'Corte', precio: 200, duracionMinutos: 30, requiereEvaluacion: false },
        },
      ])
      .mockResolvedValueOnce([]);
    const predecir = jest.fn().mockReturnValue({ probabilidadCancelacion: 0.1, nivelRiesgo: 'bajo' });
    const servicio = new RiesgoCancelacionService({ cita: { findMany } } as any, { predecir } as any);
    const resultado = await servicio.predecirLote([50, 51]);
    expect(resultado).toHaveLength(2);
    // El histórico solo se busca para clientas registradas (nunca `in: [null]`).
    expect(findMany.mock.calls[1]?.[0]?.where?.clienteId?.in ?? []).toEqual([]);
    expect(predecir).toHaveBeenCalledWith(expect.objectContaining({ cliente_nuevo: 1, citas_previas_cliente: 0, antiguedad_cliente_dias: 0 }));
  });
});
