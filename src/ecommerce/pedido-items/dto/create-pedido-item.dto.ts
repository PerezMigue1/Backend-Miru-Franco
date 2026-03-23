import { IsInt, Min } from 'class-validator';

export class CreatePedidoItemDto {
  @IsInt()
  @Min(1)
  productoId: number;

  @IsInt()
  @Min(1)
  presentacionId: number;

  @IsInt()
  @Min(1)
  cantidad: number;

  @IsInt()
  @Min(1)
  pedidoId: number;
}
