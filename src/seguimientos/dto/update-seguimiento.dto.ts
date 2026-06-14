import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSeguimientoDto {
  @IsOptional()
  @IsString()
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
