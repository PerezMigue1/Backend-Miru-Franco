import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateEmpleadoDto {
  @IsOptional()
  @IsString()
  puesto?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  especialidades?: string[];

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsDateString()
  fechaIngreso?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  comisionPorcentaje?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
