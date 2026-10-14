import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSeguimientoDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Las notas no pueden pasar de 1000 caracteres' })
  notas?: string;

  @IsOptional()
  @IsDateString()
  fechaContacto?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  satisfaccion?: number;

  @IsOptional()
  @IsBoolean()
  requiereAccion?: boolean;
}
