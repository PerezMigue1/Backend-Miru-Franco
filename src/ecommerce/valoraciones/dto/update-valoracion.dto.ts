import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateValoracionDto {
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  puntuacion?: number;

  @IsString()
  @IsOptional()
  comentario?: string | null;
}
