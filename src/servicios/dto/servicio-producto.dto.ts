import { IsInt, IsNumber, Min } from 'class-validator';

export class CreateServicioProductoDto {
  @IsInt()
  productoId: number;

  @IsNumber()
  @Min(0)
  cantidadEstimada: number = 1;
}
