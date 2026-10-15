import { BadRequestException } from '@nestjs/common';
import { normalizarRangoFechas, normalizarRangoFechasSoloDia } from './fecha-rango.util';

describe('normalizarRangoFechas', () => {
  it("un 'YYYY-MM-DD' cubre el día completo en hora de México", () => {
    const r = normalizarRangoFechas('2026-10-03', '2026-10-03');
    expect(r.gte?.toISOString()).toBe('2026-10-03T06:00:00.000Z');
    expect(r.lte?.toISOString()).toBe('2026-10-04T05:59:59.999Z');
  });

  it("un datetime ISO completo se respeta tal cual y lo ilegible responde 400 'Fecha inválida'", () => {
    expect(normalizarRangoFechas('2026-10-03T15:00:00.000Z').gte?.toISOString()).toBe('2026-10-03T15:00:00.000Z');
    expect(() => normalizarRangoFechas('no-es-fecha', undefined)).toThrow(BadRequestException);
    expect(() => normalizarRangoFechas('no-es-fecha', undefined)).toThrow('Fecha inválida');
    expect(() => normalizarRangoFechas(undefined, 'xx')).toThrow('Fecha inválida');
  });

  it('da lo mismo que el desfase fijo anterior (-06:00) para fechas actuales', () => {
    const r = normalizarRangoFechas('2026-02-14', '2026-02-14');
    expect(r.gte?.getTime()).toBe(new Date('2026-02-14T00:00:00.000-06:00').getTime());
    expect(r.lte?.getTime()).toBe(new Date('2026-02-14T23:59:59.999-06:00').getTime());
  });
});

describe('normalizarRangoFechas: desde posterior a hasta', () => {
  it('responde 400 en vez de devolver un rango vacío sin avisar', () => {
    expect(() => normalizarRangoFechas('2026-10-05', '2026-10-03')).toThrow(BadRequestException);
    expect(() => normalizarRangoFechas('2026-10-05', '2026-10-03')).toThrow('La fecha "desde" no puede ser posterior a "hasta"');
    expect(() => normalizarRangoFechas('2026-10-03T15:00:00.000Z', '2026-10-03T14:59:59.000Z')).toThrow(BadRequestException);
  });

  it('el mismo día o un rango abierto siguen igual', () => {
    expect(normalizarRangoFechas('2026-10-03', '2026-10-03').gte).toBeInstanceOf(Date);
    expect(normalizarRangoFechas('2026-10-03', undefined).lte).toBeUndefined();
    expect(normalizarRangoFechas(undefined, '2026-10-03').gte).toBeUndefined();
  });
});

describe('normalizarRangoFechasSoloDia', () => {
  it('para días guardados a medianoche UTC usa el día UTC', () => {
    const r = normalizarRangoFechasSoloDia('2026-10-03', '2026-10-05');
    expect(r.gte?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(r.lte?.toISOString()).toBe('2026-10-05T23:59:59.999Z');
  });
});
