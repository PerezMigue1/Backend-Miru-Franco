import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListSeguimientosDto {
  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  // obj[key]: el valor original; con enableImplicitConversion `value` ya llega como Boolean('false') === true.
  @Transform(({ obj, key }) => obj[key] === 'true' || obj[key] === true)
  @IsBoolean()
  requiereAccion?: boolean;

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
}
