import { IsInt, Min } from 'class-validator';

export class PedidoItemLineDto {
  @IsInt()
  @Min(1)
  productoId: number;

  @IsInt()
  @Min(1)
  presentacionId: number;

  @IsInt()
  @Min(1)
  cantidad: number;
}
