import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePresentacionDto } from './presentacion.dto';

/** productos.descuento es un porcentaje: un monto en pesos (350, 1200...) se rechaza. */
export const MENSAJE_DESCUENTO_MAX = 'El descuento es un porcentaje: no puede ser mayor a 100';
export const MENSAJE_DESCUENTO_MIN = 'El descuento es un porcentaje: no puede ser menor a 0';

export class CreateProductoDto {
  @IsInt()
  @IsOptional()
  id?: number; // normalmente lo genera la BD

  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  marca: string;

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
  nuevo?: boolean = false;

  @IsBoolean()
  @IsOptional()
  crueltyFree?: boolean = false;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  caracteristicas?: string[];

  @IsString()
  @IsOptional()
  ingredientes?: string;

  /** Modo de uso del producto (instrucciones). */
  @IsString()
  @IsOptional()
  modoUso?: string;

  /** Resultado esperado o descripción del resultado. */
  @IsString()
  @IsOptional()
  resultado?: string;
}

