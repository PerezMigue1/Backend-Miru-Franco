import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCotizacionDto {
  @IsString()
  @IsNotEmpty()
  clienteNombre: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  paqueteId: number;

  @IsDateString()
  fechaEvento: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidadPersonas?: number;

  @Type(() => Number)
  @Min(0)
  monto: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  anticipo?: number;

  @IsOptional()
  @IsString()
  notas?: string;
}
