import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCitaDto } from '../citas/dto/create-cita.dto';
import { UpdateCitaDto } from '../citas/dto/update-cita.dto';
import { ReprogramarCitaDto } from '../citas/dto/reprogramar-cita.dto';
import { CancelarCitaDto } from '../citas/dto/cancelar-cita.dto';
import { CreatePedidoDto } from '../ecommerce/pedidos/dto/create-pedido.dto';
import { CreateVentaDto } from '../pos/dto/create-venta.dto';
import { CancelarVentaDto } from '../pos/dto/cancelar-venta.dto';
import { CreateCompraDto } from './dto/create-compra.dto';
import { CreateSeguimientoDto } from '../seguimientos/dto/create-seguimiento.dto';
import { UpdateSeguimientoDto } from '../seguimientos/dto/update-seguimiento.dto';

/** Notas y motivos de texto libre con límite: antes aceptaban 90 KB. Notas 1000, motivos 500. */
const CAMPOS: [string, any, string, number, string][] = [
  ['CreateCitaDto', CreateCitaDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['UpdateCitaDto', UpdateCitaDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['ReprogramarCitaDto', ReprogramarCitaDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['CancelarCitaDto', CancelarCitaDto, 'motivoCancelacion', 500, 'El motivo no puede pasar de 500 caracteres'],
  ['CreatePedidoDto', CreatePedidoDto, 'notasCliente', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['CreateVentaDto', CreateVentaDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['CancelarVentaDto', CancelarVentaDto, 'motivoCancelacion', 500, 'El motivo no puede pasar de 500 caracteres'],
  ['CreateCompraDto', CreateCompraDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['CreateSeguimientoDto', CreateSeguimientoDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
  ['UpdateSeguimientoDto', UpdateSeguimientoDto, 'notas', 1000, 'Las notas no pueden pasar de 1000 caracteres'],
];

/** Errores del campo (las demás propiedades obligatorias que falten no importan aquí). */
async function erroresDe(dto: any, campo: string, valor: string) {
  const errores = await validate(plainToInstance(dto, { [campo]: valor }) as object);
  return errores.find((e) => e.property === campo)?.constraints ?? {};
}

describe('Límite de longitud en notas y motivos', () => {
  it.each(CAMPOS)('%s.%s rechaza más del límite con mensaje en español', async (_dto, dto, campo, limite, mensaje) => {
    expect(Object.values(await erroresDe(dto, campo, 'a'.repeat(limite + 1)))).toContain(mensaje);
  });

  it.each(CAMPOS)('%s.%s acepta justo el límite', async (_dto, dto, campo, limite) => {
    expect(await erroresDe(dto, campo, 'a'.repeat(limite))).toEqual({});
  });
});
