import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class CreateValoracionDto {
  @IsInt()
  @Min(1)
  @Max(5)
  puntuacion: number;

  @IsString()
  @IsOptional()
  comentario?: string | null;

  @IsInt()
  @Min(1)
  productoId: number;

  @IsInt()
  @Min(1)
  pedidoId: number;
}
