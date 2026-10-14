import { ValidationPipe } from '@nestjs/common';
import { ListClientesDto } from './dto/list-clientes.dto';
import { ListSeguimientosDto } from '../seguimientos/dto/list-seguimientos.dto';
import { ListCitasDto } from '../citas/dto/list-citas.dto';

/**
 * Filtros booleanos de query con el ValidationPipe global (main.ts, enableImplicitConversion): el
 * texto "false" no debe leerse como true (Boolean('false') === true).
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const leer = (metatype: any, query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype });

describe('Filtros booleanos de query', () => {
  it.each([
    ['GET /clientes?incluirInactivos', ListClientesDto, 'incluirInactivos'],
    ['GET /seguimientos?requiereAccion', ListSeguimientosDto, 'requiereAccion'],
    ['GET /citas?propios', ListCitasDto, 'propios'],
  ])('%s: "true" es true y "false" es false', async (_ruta, dto, campo) => {
    expect((await leer(dto, { [campo]: 'true' }))[campo]).toBe(true);
    expect((await leer(dto, { [campo]: 'false' }))[campo]).toBe(false);
  });

  it('GET /citas?propios=0 no activa el modo portal; "1" sí', async () => {
    expect((await leer(ListCitasDto, { propios: '0' })).propios).toBe(false);
    expect((await leer(ListCitasDto, { propios: '1' })).propios).toBe(true);
  });

  it('sin el parámetro, incluirInactivos queda en false', async () => {
    expect((await leer(ListClientesDto, {})).incluirInactivos).toBe(false);
  });
});
