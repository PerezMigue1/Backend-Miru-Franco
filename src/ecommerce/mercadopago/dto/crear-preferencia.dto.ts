import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Solo el pedido: artículos y montos los calcula el servidor desde la base. */
export class CrearPreferenciaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pedidoId: number;
}
