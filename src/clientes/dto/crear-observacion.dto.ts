import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /clientes/:id/observaciones: nota interna del personal sobre la clienta. */
export class CrearObservacionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Escribe la observación.' })
  @IsString({ message: 'La observación debe ser texto.' })
  @MaxLength(1000, { message: 'La observación puede tener como máximo 1000 caracteres.' })
  texto: string;
}
