import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { crearErrorDeValidacion } from '../../common/filters/errores-validacion';
import { TruncateTableDto } from './truncate-table.dto';

/**
 * Las opciones de truncate son booleanos estrictos: con enableImplicitConversion (main.ts) el texto "false"
 * llegaba como true y vaciaba en cascada o reiniciaba los ids aunque la persona no lo pidiera.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: crearErrorDeValidacion,
});

async function validar(cuerpo: Record<string, unknown>) {
  try {
    return { valor: (await pipe.transform(cuerpo, { type: 'body', metatype: TruncateTableDto } as ArgumentMetadata)) as TruncateTableDto, error: null };
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return { valor: null, error: e as BadRequestException };
  }
}

const BASE = { tabla: 'servicios', confirmacion: 'TRUNCATE servicios' };

describe('TruncateTableDto: cascade y restartIdentity solo aceptan booleanos reales', () => {
  it.each(['false', 'true', 'no', 0, 1])('cascade = %p da 400', async (valor) => {
    const { error } = await validar({ ...BASE, cascade: valor });
    expect(error).not.toBeNull();
  });

  it.each(['false', 'no', 0])('restartIdentity = %p da 400', async (valor) => {
    const { error } = await validar({ ...BASE, restartIdentity: valor });
    expect(error).not.toBeNull();
  });

  it('con booleanos reales pasan tal cual', async () => {
    const { valor } = await validar({ ...BASE, cascade: false, restartIdentity: false });
    expect(valor).toMatchObject({ cascade: false, restartIdentity: false });
  });

  it('si no vienen, quedan los valores por defecto (sin cascada)', async () => {
    const { valor } = await validar(BASE);
    expect(valor?.cascade).toBe(false);
  });
});
