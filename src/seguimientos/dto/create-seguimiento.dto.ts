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
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSeguimientoDto {
  @IsUUID()
  @IsNotEmpty()
  usuarioId: string;

  @IsString()
  @IsNotEmpty()
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
}
