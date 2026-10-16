import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';
import { MAX_MOTIVO, MAX_PLANTILLA } from '../documentos-legales.constants';

/** Valor crudo del cuerpo: la conversión implícita de la ValidationPipe global no convierte un número en texto. */
const Crudo = () => Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]);

/**
 * Cuerpos de Admin > Documentos legales. Aquí solo se revisan tipos y largos: las reglas (versión mayor, fecha de hoy
 * o futura, motivo, variables y formato permitidos) las aplica el servicio con mensajes en español.
 */
export class PlantillaDto {
  @Crudo()
  @IsString({ message: 'Escribe el texto del documento.' })
  @MaxLength(MAX_PLANTILLA, { message: `El documento tiene como máximo ${MAX_PLANTILLA} caracteres.` })
  plantilla: string;
}

export class VistaPreviaDto extends PlantillaDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  vigenteDesde?: string;
}

export class PublicarVersionDto extends PlantillaDto {
  @IsString({ message: 'Escribe el número de versión (X.Y).' })
  @MaxLength(10, { message: 'La versión debe tener la forma X.Y (por ejemplo, 2.1).' })
  version: string;

  @IsString({ message: 'Elige la fecha de vigencia.' })
  @MaxLength(10, { message: 'La fecha de vigencia debe tener la forma AAAA-MM-DD.' })
  vigenteDesde: string;

  @IsString({ message: 'Escribe el motivo del cambio.' })
  @MaxLength(MAX_MOTIVO, { message: `El motivo tiene como máximo ${MAX_MOTIVO} caracteres.` })
  motivo: string;

  /** Por omisión true (cambio importante: se pide volver a aceptar). */
  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'requiereAceptacion debe ser verdadero o falso.' })
  requiereAceptacion?: boolean;
}
