import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

const ESTADOS_CITA = ['pendiente', 'confirmada', 'en_curso', 'completada', 'cancelada', 'reprogramada', 'no_asistio'] as const;

export class UpdateCitaDto {
  @IsOptional()
  @IsUUID()
  especialistaId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId?: number;

  @IsOptional()
  @IsDateString()
  fechaHoraInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaHoraFin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Las notas no pueden pasar de 1000 caracteres' })
  notas?: string;

  @IsOptional()
  @IsIn(ESTADOS_CITA)
  estado?: string;
}
