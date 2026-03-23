import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateCarritoItemDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  cantidad?: number;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  precioReferencia?: number | null;
}
