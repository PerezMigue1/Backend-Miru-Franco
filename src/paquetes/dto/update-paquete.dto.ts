import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Actualización parcial de paquete.
 * Definido explícitamente para no depender de '@nestjs/mapped-types'.
 */
export class UpdatePaqueteDto {
  @IsString()
  @IsOptional()
  tipo_evento?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  servicios_vinculados?: string[];

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  precio_especial?: number;
}
