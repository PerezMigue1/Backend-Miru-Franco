import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePresentacionDto } from './presentacion.dto';
import { MENSAJE_DESCUENTO_MAX, MENSAJE_DESCUENTO_MIN } from './create-producto.dto';

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

  @IsInt()
  @Min(0, { message: MENSAJE_DESCUENTO_MIN })
  @Max(100, { message: MENSAJE_DESCUENTO_MAX })
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

  @IsBoolean()
  @IsOptional()
  nuevo?: boolean;

  @IsBoolean()
  @IsOptional()
  crueltyFree?: boolean;

  /** true reactiva un producto desactivado (DELETE pone false). */
  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  caracteristicas?: string[];

  @IsString()
  @IsOptional()
  ingredientes?: string;

  @IsString()
  @IsOptional()
  modoUso?: string;

  @IsString()
  @IsOptional()
  resultado?: string;
}


