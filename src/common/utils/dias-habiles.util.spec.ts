import { diasHabilesEntre, esDiaHabil, esFestivoOficial, sumarDiasHabiles } from './dias-habiles.util';

/** Mediodía de ese día en hora de México (UTC-6): el día de calendario no depende de la hora. */
const mx = (dia: string, hora = '12:00:00.000') => new Date(`${dia}T${hora}-06:00`);

/** Todos los días festivos oficiales de un año, en 'YYYY-MM-DD', recorriendo el año día por día. */
function festivosDelAnio(anio: number): string[] {
  const festivos: string[] = [];
  for (let t = Date.UTC(anio, 0, 1); new Date(t).getUTCFullYear() === anio; t += 24 * 60 * 60 * 1000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    if (esFestivoOficial(mx(dia))) festivos.push(dia);
  }
  return festivos;
}

describe('esFestivoOficial: art. 74 de la Ley Federal del Trabajo', () => {
  it('2026: exactamente 1 ene, 2 feb, 16 mar, 1 may, 16 sep, 16 nov y 25 dic', () => {
    expect(festivosDelAnio(2026)).toEqual([
      '2026-01-01',
      '2026-02-02',
      '2026-03-16',
      '2026-05-01',
      '2026-09-16',
      '2026-11-16',
      '2026-12-25',
    ]);
  });

  it('2027: exactamente 1 ene, 1 feb, 15 mar, 1 may, 6 jun (jornada electoral), 16 sep, 15 nov y 25 dic', () => {
    expect(festivosDelAnio(2027)).toEqual([
      '2027-01-01',
      '2027-02-01',
      '2027-03-15',
      '2027-05-01',
      '2027-06-06',
      '2027-09-16',
      '2027-11-15',
      '2027-12-25',
    ]);
  });

  it('el 1 de octubre solo es festivo en los años de transmisión del Poder Ejecutivo (2024, 2030, 2036)', () => {
    expect(esFestivoOficial(mx('2026-10-01'))).toBe(false);
    expect(esFestivoOficial(mx('2024-10-01'))).toBe(true);
    expect(esFestivoOficial(mx('2030-10-01'))).toBe(true);
    expect(esFestivoOficial(mx('2036-10-01'))).toBe(true);
    expect(esFestivoOficial(mx('2027-10-01'))).toBe(false);
  });

  it('la jornada electoral federal ordinaria es el primer domingo de junio de 2027, 2030 y 2033', () => {
    expect(esFestivoOficial(mx('2027-06-06'))).toBe(true);
    expect(esFestivoOficial(mx('2030-06-02'))).toBe(true);
    expect(esFestivoOficial(mx('2033-06-05'))).toBe(true);
    expect(esFestivoOficial(mx('2026-06-07'))).toBe(false);
    expect(esFestivoOficial(mx('2028-06-04'))).toBe(false);
  });

  it('el día se toma en hora de México, no en UTC', () => {
    // 31 dic 2025 a las 23:59:59.999 en México (ya es 1 de enero en UTC): no es festivo.
    expect(esFestivoOficial(new Date('2026-01-01T05:59:59.999Z'))).toBe(false);
    // 1 ene 2026 a las 00:00 en México: festivo.
    expect(esFestivoOficial(new Date('2026-01-01T06:00:00.000Z'))).toBe(true);
    // 1 ene 2026 a las 23:59:59.999 en México (ya es 2 de enero en UTC): sigue siendo festivo.
    expect(esFestivoOficial(new Date('2026-01-02T05:59:59.999Z'))).toBe(true);
  });
});

describe('esDiaHabil: se excluyen solo los domingos y los festivos oficiales', () => {
  it('los sábados son hábiles', () => {
    expect(esDiaHabil(mx('2026-10-17'))).toBe(true);
    expect(esDiaHabil(mx('2027-01-02'))).toBe(true);
  });

  it('los domingos no son hábiles', () => {
    expect(esDiaHabil(mx('2026-10-18'))).toBe(false);
    expect(esDiaHabil(mx('2026-02-01'))).toBe(false);
  });

  it('de lunes a viernes son hábiles si no son festivos', () => {
    for (const dia of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
      expect(esDiaHabil(mx(dia))).toBe(true);
    }
  });

  it('ningún festivo de 2026 ni de 2027 es hábil, aunque caiga en sábado', () => {
    for (const dia of [...festivosDelAnio(2026), ...festivosDelAnio(2027)]) expect(esDiaHabil(mx(dia))).toBe(false);
    // 1 de mayo y 25 de diciembre de 2027 caen en sábado.
    expect(esDiaHabil(mx('2027-05-01'))).toBe(false);
    expect(esDiaHabil(mx('2027-12-25'))).toBe(false);
  });

  it('el 1 de octubre de 2026 es hábil y el de 2030 no', () => {
    expect(esDiaHabil(mx('2026-10-01'))).toBe(true);
    expect(esDiaHabil(mx('2030-10-01'))).toBe(false);
  });

  it('el día se toma en hora de México: el sábado a las 23:59 sigue siendo hábil', () => {
    // Sábado 17 oct 2026 a las 23:59:59.999 en México (domingo en UTC).
    expect(esDiaHabil(new Date('2026-10-18T05:59:59.999Z'))).toBe(true);
    // Domingo 18 oct 2026 a las 00:00 en México.
    expect(esDiaHabil(new Date('2026-10-18T06:00:00.000Z'))).toBe(false);
  });
});

describe('sumarDiasHabiles: fin (23:59:59.999 hora de México) del n-ésimo día hábil posterior', () => {
  it('el día del evento no cuenta y el sábado sí: miércoles 14 oct 2026 + 5 = martes 20 oct', () => {
    // jue 15 (1), vie 16 (2), sáb 17 (3), dom 18 no, lun 19 (4), mar 20 (5).
    expect(sumarDiasHabiles(mx('2026-10-14'), 5).toISOString()).toBe('2026-10-21T05:59:59.999Z');
  });

  it('vence al final del último día hábil en hora de México', () => {
    const vence = sumarDiasHabiles(mx('2026-10-14'), 1);
    expect(vence.getTime()).toBe(new Date('2026-10-15T23:59:59.999-06:00').getTime());
  });

  it('la hora del evento no cambia el vencimiento; el día se toma en hora de México', () => {
    // Miércoles 14 oct a las 00:00 y a las 23:59:59.999 en México: ambos vencen el jueves 15.
    expect(sumarDiasHabiles(new Date('2026-10-14T06:00:00.000Z'), 1).toISOString()).toBe('2026-10-16T05:59:59.999Z');
    expect(sumarDiasHabiles(new Date('2026-10-15T05:59:59.999Z'), 1).toISOString()).toBe('2026-10-16T05:59:59.999Z');
    // Jueves 15 oct a las 00:00 en México: vence el viernes 16.
    expect(sumarDiasHabiles(new Date('2026-10-15T06:00:00.000Z'), 1).toISOString()).toBe('2026-10-17T05:59:59.999Z');
  });

  it('cruza el fin de semana: viernes + 1 = sábado; sábado + 1 = lunes', () => {
    expect(sumarDiasHabiles(mx('2026-10-16'), 1).toISOString()).toBe('2026-10-18T05:59:59.999Z');
    expect(sumarDiasHabiles(mx('2026-10-17'), 1).toISOString()).toBe('2026-10-20T05:59:59.999Z');
  });

  it('cruza un festivo en lunes: viernes 13 nov 2026 + 2 = martes 17 nov', () => {
    // sáb 14 (1), dom 15 no, lun 16 festivo, mar 17 (2).
    expect(sumarDiasHabiles(mx('2026-11-13'), 2).toISOString()).toBe('2026-11-18T05:59:59.999Z');
  });

  it('revocación de 5 días hábiles desde el viernes 30 ene 2026 (cruza el 2 de febrero) vence el viernes 6 feb', () => {
    // sáb 31 (1), dom 1 no, lun 2 festivo, mar 3 (2), mié 4 (3), jue 5 (4), vie 6 (5).
    expect(sumarDiasHabiles(mx('2026-01-30'), 5).toISOString()).toBe('2026-02-07T05:59:59.999Z');
  });

  it('cruza el 16 de marzo de 2026: viernes 13 + 1 = sábado 14; + 2 = martes 17', () => {
    expect(sumarDiasHabiles(mx('2026-03-13'), 1).toISOString()).toBe('2026-03-15T05:59:59.999Z');
    expect(sumarDiasHabiles(mx('2026-03-13'), 2).toISOString()).toBe('2026-03-18T05:59:59.999Z');
  });

  it('cruza Navidad y Año Nuevo', () => {
    // mié 23 dic 2026: jue 24 (1), vie 25 festivo, sáb 26 (2), dom 27 no, lun 28 (3), mar 29 (4), mié 30 (5).
    expect(sumarDiasHabiles(mx('2026-12-23'), 5).toISOString()).toBe('2026-12-31T05:59:59.999Z');
    // mar 29 dic 2026: mié 30 (1), jue 31 (2), vie 1 ene 2027 festivo, sáb 2 ene (3).
    expect(sumarDiasHabiles(mx('2026-12-29'), 3).toISOString()).toBe('2027-01-03T05:59:59.999Z');
  });

  it('ARCO: 20 días hábiles desde el miércoles 14 oct 2026 vencen el viernes 6 nov (el 2 de noviembre es hábil)', () => {
    expect(sumarDiasHabiles(mx('2026-10-14'), 20).toISOString()).toBe('2026-11-07T05:59:59.999Z');
  });

  it('el 1 de octubre de 2030 no cuenta y el de 2026 sí', () => {
    // lun 30 sep 2030 + 1: mar 1 oct festivo, mié 2 oct (1).
    expect(sumarDiasHabiles(mx('2030-09-30'), 1).toISOString()).toBe('2030-10-03T05:59:59.999Z');
    // mié 30 sep 2026 + 1: jue 1 oct (1).
    expect(sumarDiasHabiles(mx('2026-09-30'), 1).toISOString()).toBe('2026-10-02T05:59:59.999Z');
  });

  it('siempre devuelve las 23:59:59.999 hora de México (05:59:59.999 UTC del día siguiente)', () => {
    for (let n = 1; n <= 30; n++) {
      const vence = sumarDiasHabiles(mx('2026-10-14', '08:30:00.000'), n);
      expect(vence.toISOString().slice(11)).toBe('05:59:59.999Z');
      // El día que vence (en México) siempre es hábil.
      expect(esDiaHabil(vence)).toBe(true);
    }
  });

  it('rechaza n que no sea entero positivo y fechas inválidas', () => {
    expect(() => sumarDiasHabiles(mx('2026-10-14'), 0)).toThrow(RangeError);
    expect(() => sumarDiasHabiles(mx('2026-10-14'), -1)).toThrow(RangeError);
    expect(() => sumarDiasHabiles(mx('2026-10-14'), 1.5)).toThrow(RangeError);
    expect(() => sumarDiasHabiles(new Date('no-es-fecha'), 1)).toThrow(RangeError);
  });
});

describe('diasHabilesEntre: días hábiles después del día de "desde" hasta el día de "hasta" (inclusive)', () => {
  it('el mismo día o "hasta" anterior dan 0', () => {
    expect(diasHabilesEntre(mx('2026-10-14', '08:00:00.000'), mx('2026-10-14', '20:00:00.000'))).toBe(0);
    expect(diasHabilesEntre(mx('2026-10-20'), mx('2026-10-14'))).toBe(0);
  });

  it('miércoles 14 oct 2026 a martes 20 oct = 5 (el sábado cuenta, el domingo no)', () => {
    expect(diasHabilesEntre(mx('2026-10-14'), mx('2026-10-20'))).toBe(5);
  });

  it('excepción de 10 días hábiles: pago el miércoles 14 oct 2026', () => {
    // Cita el lunes 26 oct: exactamente 10 (no es "más de 10").
    expect(diasHabilesEntre(mx('2026-10-14'), mx('2026-10-26', '10:00:00.000'))).toBe(10);
    // Cita el domingo 25 oct: 9.
    expect(diasHabilesEntre(mx('2026-10-14'), mx('2026-10-25', '10:00:00.000'))).toBe(9);
    // Cita el miércoles 28 oct: 12 (más de 10).
    expect(diasHabilesEntre(mx('2026-10-14'), mx('2026-10-28', '10:00:00.000'))).toBe(12);
  });

  it('no cuenta los festivos: viernes 13 nov 2026 a martes 17 nov = 2', () => {
    expect(diasHabilesEntre(mx('2026-11-13'), mx('2026-11-17'))).toBe(2);
  });

  it('los días se toman en hora de México', () => {
    // Miércoles 14 oct 23:59:59.999 a jueves 15 oct 00:00 en México: 1 día hábil.
    expect(diasHabilesEntre(new Date('2026-10-15T05:59:59.999Z'), new Date('2026-10-15T06:00:00.000Z'))).toBe(1);
  });

  it('es el inverso de sumarDiasHabiles', () => {
    for (const desde of ['2026-01-30', '2026-10-14', '2026-11-13', '2026-12-23', '2027-05-31']) {
      for (let n = 1; n <= 25; n++) {
        expect(diasHabilesEntre(mx(desde), sumarDiasHabiles(mx(desde), n))).toBe(n);
      }
    }
  });

  it('rechaza fechas inválidas', () => {
    expect(() => diasHabilesEntre(new Date('xx'), mx('2026-10-14'))).toThrow(RangeError);
    expect(() => diasHabilesEntre(mx('2026-10-14'), new Date('xx'))).toThrow(RangeError);
  });
});

describe('Revisión: plazos de ley sin los días inhábiles del salón', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { establecerReglasNegocio } = require('../../configuracion-sitio/reglas-negocio');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SOLO_DIAS_DE_LEY } = require('./dias-habiles.util');
  afterEach(() => establecerReglasNegocio(null));

  it('ARCO (SOLO_DIAS_DE_LEY) no se alarga con días inhábiles del salón; sin lista, sí cuentan los vigentes', () => {
    const desde = new Date('2026-11-09T12:00:00-06:00');
    const deLey = sumarDiasHabiles(desde, 20, SOLO_DIAS_DE_LEY);
    establecerReglasNegocio({ diasInhabiles: [{ fecha: '2026-11-10', motivo: '' }, { fecha: '2026-11-11', motivo: '' }] });
    expect(sumarDiasHabiles(desde, 20, SOLO_DIAS_DE_LEY)).toEqual(deLey);
    expect(sumarDiasHabiles(desde, 20).getTime()).toBeGreaterThan(deLey.getTime());
    expect(diasHabilesEntre(desde, deLey, ['2026-11-10'])).toBe(19);
  });
});
