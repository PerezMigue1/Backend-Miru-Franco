import {
  diaEnMexico,
  diasHastaDiaCalendario,
  esDiaValido,
  inicioDiaMexico,
  rangoDiaMexico,
  rangoMesMexico,
  sumarDias,
} from './zona-mexico';

/** ¿El instante cae dentro del rango del día (como lo filtra Prisma con gte/lte)? */
const dentro = (instante: string, rango: { desde: Date; hasta: Date }) => {
  const t = new Date(instante).getTime();
  return t >= rango.desde.getTime() && t <= rango.hasta.getTime();
};

describe('zona-mexico', () => {
  it('el día 3 en México va de las 00:00 a las 23:59:59.999 hora de México', () => {
    const r = rangoDiaMexico('2026-10-03');
    expect(r.desde.toISOString()).toBe('2026-10-03T06:00:00.000Z');
    expect(r.hasta.toISOString()).toBe('2026-10-04T05:59:59.999Z');
  });

  it('una venta a las 23:30 del día 3 (México) cuenta en el día 3, y una a las 00:10 del 4 en el día 4', () => {
    const ventaNoche = '2026-10-04T05:30:00.000Z'; // 3 oct 23:30 en México
    const ventaMadrugada = '2026-10-04T06:10:00.000Z'; // 4 oct 00:10 en México
    expect(dentro(ventaNoche, rangoDiaMexico('2026-10-03'))).toBe(true);
    expect(dentro(ventaNoche, rangoDiaMexico('2026-10-04'))).toBe(false);
    expect(dentro(ventaMadrugada, rangoDiaMexico('2026-10-04'))).toBe(true);
    expect(dentro(ventaMadrugada, rangoDiaMexico('2026-10-03'))).toBe(false);
  });

  it('"hoy" a las 19:00 y a las 23:59 hora de México sigue siendo el mismo día', () => {
    expect(diaEnMexico(new Date('2026-10-04T01:00:00.000Z'))).toBe('2026-10-03'); // 19:00
    expect(diaEnMexico(new Date('2026-10-04T05:59:00.000Z'))).toBe('2026-10-03'); // 23:59
    expect(diaEnMexico(new Date('2026-10-04T06:00:00.000Z'))).toBe('2026-10-04'); // 00:00
  });

  it('caducidad de hoy, mañana y ayer da 0, 1 y -1 a las 08:00 y a las 23:30 de México', () => {
    for (const ahora of ['2026-10-03T14:00:00.000Z', '2026-10-04T05:30:00.000Z']) {
      const a = new Date(ahora);
      // Guardadas a mediodía UTC (formulario) o a medianoche UTC (importación): mismo resultado.
      expect(diasHastaDiaCalendario(new Date('2026-10-03T12:00:00.000Z'), a)).toBe(0);
      expect(diasHastaDiaCalendario(new Date('2026-10-04T00:00:00.000Z'), a)).toBe(1);
      expect(diasHastaDiaCalendario(new Date('2026-10-02T12:00:00.000Z'), a)).toBe(-1);
    }
  });

  it('el mes de México empieza a las 00:00 del día 1 y termina antes de las 00:00 del siguiente', () => {
    const oct = rangoMesMexico(2026, 10);
    expect(oct.desde.toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(oct.hasta.toISOString()).toBe('2026-11-01T05:59:59.999Z');
    expect(rangoMesMexico(2026, 12).hasta.toISOString()).toBe('2027-01-01T05:59:59.999Z');
  });

  it('inicioDiaMexico sigue la regla horaria real (en 2021 México aún tenía horario de verano)', () => {
    expect(inicioDiaMexico('2021-07-01').toISOString()).toBe('2021-07-01T05:00:00.000Z'); // UTC-5
    expect(inicioDiaMexico('2021-12-01').toISOString()).toBe('2021-12-01T06:00:00.000Z'); // UTC-6
  });

  it('sumarDias y esDiaValido', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(esDiaValido('2026-02-29')).toBe(false);
    expect(esDiaValido('2028-02-29')).toBe(true);
    expect(esDiaValido('2026-10-3')).toBe(false);
  });
});
