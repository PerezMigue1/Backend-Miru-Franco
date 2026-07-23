import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DisponibilidadCitasDto {
  @IsString()
  @IsNotEmpty()
  especialistaId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener formato YYYY-MM-DD' })
  fecha: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId: number;
}
