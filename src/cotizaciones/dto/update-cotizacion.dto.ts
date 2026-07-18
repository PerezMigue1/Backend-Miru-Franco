import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

const ESTADOS_COTIZACION = ['pendiente', 'confirmada', 'cancelada'] as const;

/**
 * DTO para actualización parcial de cotizaciones.
 * Equivalente a Partial<CreateCotizacionDto> + `estado`, definido explícitamente
 * para evitar depender de '@nestjs/mapped-types'.
 */
export class UpdateCotizacionDto {
  @IsOptional()
  @IsString()
  clienteNombre?: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  paqueteId?: number;

  @IsOptional()
  @IsDateString()
  fechaEvento?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidadPersonas?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  monto?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  anticipo?: number;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsIn(ESTADOS_COTIZACION)
  estado?: (typeof ESTADOS_COTIZACION)[number];
}
