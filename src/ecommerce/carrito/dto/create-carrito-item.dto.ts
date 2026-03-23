import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateCarritoItemDto {
  @IsInt()
  @Min(1)
  productoId: number;

  @IsInt()
  @Min(1)
  presentacionId: number;

  @IsInt()
  @Min(1)
  cantidad: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  precioReferencia?: number;
}
