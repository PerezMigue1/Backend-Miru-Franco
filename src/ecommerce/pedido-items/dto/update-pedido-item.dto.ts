import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePedidoItemDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  cantidad?: number;

  @IsString()
  @IsOptional()
  nombreProducto?: string | null;

  @IsString()
  @IsOptional()
  tamanio?: string | null;
}
