import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RangoFechasDto } from './rango-fechas.dto';

describe('RangoFechasDto', () => {
  it('acepta fechas ISO (solo día o datetime completo)', async () => {
    const dto = plainToInstance(RangoFechasDto, { desde: '2026-10-03', hasta: '2026-10-03T15:00:00.000Z' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza texto ilegible con mensaje en español', async () => {
    const errores = await validate(plainToInstance(RangoFechasDto, { desde: 'xx' }));
    expect(errores).toHaveLength(1);
    expect(Object.values(errores[0].constraints ?? {})).toContain('La fecha "desde" no es válida (usa AAAA-MM-DD)');

    const erroresHasta = await validate(plainToInstance(RangoFechasDto, { hasta: 'no-es-fecha' }));
    expect(erroresHasta).toHaveLength(1);
    expect(Object.values(erroresHasta[0].constraints ?? {})).toContain('La fecha "hasta" no es válida (usa AAAA-MM-DD)');
  });

  it('un rango vacío sigue siendo válido (ambos campos opcionales)', async () => {
    expect(await validate(plainToInstance(RangoFechasDto, {}))).toHaveLength(0);
  });
});
