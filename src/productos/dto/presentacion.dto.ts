import {
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
  @IsString()
  @IsNotEmpty()
  tamanio: string; // ej. "1000ml"

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
