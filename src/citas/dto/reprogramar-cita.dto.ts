import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReprogramarCitaDto {
  @IsDateString()
  fechaHoraInicio: string;

  @IsDateString()
  fechaHoraFin: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Las notas no pueden pasar de 1000 caracteres' })
  notas?: string;
}
