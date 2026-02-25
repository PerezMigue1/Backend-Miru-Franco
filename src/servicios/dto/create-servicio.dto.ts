import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateServicioProductoDto } from './servicio-producto.dto';
import { AsignarEspecialistaDto } from './servicio-especialista.dto';

export class CreateServicioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  @IsOptional()
  descripcionLarga?: string;

  @IsNumber()
  @Min(0)
  precio: number;

  @IsInt()
  @Min(1)
  duracionMinutos: number;

  @IsString()
  @IsNotEmpty()
  categoria: string;

  @IsBoolean()
  @IsOptional()
  requiereEvaluacion?: boolean = false;

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
  activo?: boolean = true;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateServicioProductoDto)
  @IsOptional()
  productosAsociados?: CreateServicioProductoDto[];

  /** IDs de usuarios (especialistas) que realizan este servicio */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AsignarEspecialistaDto)
  @IsOptional()
  especialistas?: AsignarEspecialistaDto[];
}
