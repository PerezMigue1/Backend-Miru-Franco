import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateDevolucionDto {
  @IsString()
  @IsOptional()
  estado?: string;

  @IsString()
  @IsOptional()
  motivo?: string | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto?: number | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  pedidoItemId?: number | null;

  @IsInt()
  @Min(1)
  @IsOptional()
  pagoId?: number | null;
}
