import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

const ESTADOS_CITA = ['pendiente', 'confirmada', 'en_curso', 'completada', 'cancelada', 'reprogramada', 'no_asistio'] as const;

export class ListCitasDto {
  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @IsString()
  especialistaId?: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsIn(ESTADOS_CITA)
  estado?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
