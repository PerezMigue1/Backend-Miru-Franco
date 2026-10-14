import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSeguimientoDto {
  @IsUUID()
  @IsNotEmpty()
  usuarioId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000, { message: 'Las notas no pueden pasar de 1000 caracteres' })
  notas: string;

  @IsDateString()
  fechaContacto: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  satisfaccion?: number;

  @IsBoolean()
  requiereAccion: boolean;

  /** Cita a la que corresponde el seguimiento (opcional). Se valida que exista. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  citaId?: number;
}
