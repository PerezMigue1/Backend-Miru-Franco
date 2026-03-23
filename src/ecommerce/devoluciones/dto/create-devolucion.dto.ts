import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateDevolucionDto {
  @IsInt()
  @Min(1)
  pedidoId: number;

  @IsInt()
  @IsOptional()
  pedidoItemId?: number | null;

  @IsInt()
  @IsOptional()
  pagoId?: number | null;

  @IsString()
  estado: string;

  @IsString()
  @IsOptional()
  motivo?: string | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto?: number | null;
}
