import { IsDateString, IsOptional, IsString } from 'class-validator';

export class ReprogramarCitaDto {
  @IsDateString()
  fechaHoraInicio: string;

  @IsDateString()
  fechaHoraFin: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
