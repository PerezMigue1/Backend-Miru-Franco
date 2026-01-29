import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePresentacionDto } from './presentacion.dto';

/**
 * DTO para actualización parcial de productos.
 * Equivalente a Partial<CreateProductoDto>, definido explícitamente
 * para evitar depender de '@nestjs/mapped-types'.
 */
export class UpdateProductoDto {
  @IsInt()
  @IsOptional()
  id?: number;

  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  marca?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  descripcion?: string;

  @IsString()
  @IsOptional()
  descripcionLarga?: string;

  @IsString()
  @IsOptional()
  precio?: string;

  @IsString()
  @IsOptional()
  precioOriginal?: string;

  @IsInt()
  @IsOptional()
  descuento?: number;

  @IsString()
  @IsOptional()
  categoria?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePresentacionDto)
  @IsOptional()
  presentaciones?: CreatePresentacionDto[];

  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsBoolean()
  @IsOptional()
  disponible?: boolean;

  @IsBoolean()
  @IsOptional()
  nuevo?: boolean;

  @IsBoolean()
  @IsOptional()
  crueltyFree?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  caracteristicas?: string[];

  @IsString()
  @IsOptional()
  ingredientes?: string;
}


