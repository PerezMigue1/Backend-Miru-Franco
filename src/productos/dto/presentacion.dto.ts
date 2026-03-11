import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreatePresentacionDto {
  @IsString()
  @IsNotEmpty()
  tamanio: string; // ej. "1000ml"

  @IsString()
  @IsNotEmpty()
  precio: string; // ej. "$250"

  @IsString()
  @IsOptional()
  precioOriginal?: string;

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

