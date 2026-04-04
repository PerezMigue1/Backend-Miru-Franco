import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreatePresentacionDto } from './presentacion.dto';

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

