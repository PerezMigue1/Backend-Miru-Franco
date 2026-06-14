import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmpleadoDto {
  @IsUUID()
  @IsNotEmpty()
  usuarioId: string;

  @IsString()
  @IsNotEmpty()
  puesto: string;

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
