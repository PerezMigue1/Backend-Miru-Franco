import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductoDto } from './create-producto.dto';
import { UpdateProductoDto } from './update-producto.dto';

/**
 * productos.descuento es un PORCENTAJE (0 a 100). En 107 de 169 productos guardaba un monto en pesos
 * (350, 1200...) y la pantalla vieja derivaba de ahí precios negativos. El DTO ya no lo acepta.
 */
const BASE_CREAR = { nombre: 'Shampoo', marca: 'AVYNA' };

async function erroresDescuento(Dto: new () => object, descuento: unknown) {
  const cuerpo = Dto === CreateProductoDto ? { ...BASE_CREAR, descuento } : { descuento };
  const errores = await validate(plainToInstance(Dto, cuerpo, { enableImplicitConversion: true }), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errores.filter((e) => e.property === 'descuento').flatMap((e) => Object.values(e.constraints ?? {}));
}

describe.each([
  ['CreateProductoDto', CreateProductoDto],
  ['UpdateProductoDto', UpdateProductoDto],
])('%s: descuento es un porcentaje de 0 a 100', (_nombre, Dto) => {
  it('rechaza 350 (un monto en pesos) con mensaje en español', async () => {
    expect(await erroresDescuento(Dto, 350)).toEqual(['El descuento es un porcentaje: no puede ser mayor a 100']);
  });

  it('rechaza -5 con mensaje en español', async () => {
    expect(await erroresDescuento(Dto, -5)).toEqual(['El descuento es un porcentaje: no puede ser menor a 0']);
  });

  it.each([0, 100, undefined])('acepta %p', async (descuento) => {
    expect(await erroresDescuento(Dto, descuento)).toEqual([]);
  });
});
