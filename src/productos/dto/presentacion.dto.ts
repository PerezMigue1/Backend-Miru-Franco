import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePresentacionDto {
  /** Solo en actualización de producto: identifica la fila en `producto_presentaciones`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  id?: number;

  @IsString()
  @IsNotEmpty()
  tamanio: string; // ej. "1000ml"

  /** URLs de imágenes de esta presentación (no del producto global). */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  imagenes?: string[];

  /** Precio en MXN (2 decimales recomendados) */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  precio: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  precioOriginal?: number;

  @IsInt()
  @Min(0)
  stock: number;

  @IsBoolean()
  @IsOptional()
  disponible?: boolean = true;

  /** Fecha de caducidad (ISO 8601: "2025-12-31") */
  @IsDateString()
  @IsOptional()
  fechaCaducidad?: string;
}
