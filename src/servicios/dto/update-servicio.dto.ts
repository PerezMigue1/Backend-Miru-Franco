import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateServicioProductoDto } from './servicio-producto.dto';
import { AsignarEspecialistaDto } from './servicio-especialista.dto';

export class UpdateServicioDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  descripcionLarga?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  precio?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  duracionMinutos?: number;

  @IsString()
  @IsOptional()
  categoria?: string;

  @IsBoolean()
  @IsOptional()
  requiereEvaluacion?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  imagen?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  incluye?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  recomendaciones?: string[];

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateServicioProductoDto)
  @IsOptional()
  productosAsociados?: CreateServicioProductoDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AsignarEspecialistaDto)
  @IsOptional()
  especialistas?: AsignarEspecialistaDto[];
}
