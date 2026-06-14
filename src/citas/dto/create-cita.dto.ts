import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCitaDto {
  @IsUUID()
  @IsNotEmpty()
  clienteId: string;

  @IsUUID()
  @IsNotEmpty()
  especialistaId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId: number;

  @IsDateString()
  fechaHoraInicio: string;

  @IsDateString()
  fechaHoraFin: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
