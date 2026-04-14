import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListMovimientosDto {
  @IsOptional()
  @IsIn(['entrada', 'salida', 'ajuste'])
  tipo?: 'entrada' | 'salida' | 'ajuste';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productoId?: number;

  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['creadoEn:asc', 'creadoEn:desc', 'creadoen:asc', 'creadoen:desc'])
  sort?: string = 'creadoEn:desc';
}
