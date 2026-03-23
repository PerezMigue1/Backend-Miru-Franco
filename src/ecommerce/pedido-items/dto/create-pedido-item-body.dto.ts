import { IsInt, Min } from 'class-validator';

/** Cuerpo POST .../pedidos/:pedidoId/items (pedidoId va en la URL) */
export class CreatePedidoItemBodyDto {
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
