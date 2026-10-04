import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { esPropios } from '../../common/utils/alcance-propio.util';

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

  /** Campo de orden. Por defecto 'fechaHoraInicio' (asc, comportamiento histórico). */
  @IsOptional()
  @IsIn(['fechaHoraInicio', 'creadoEn'])
  orden?: 'fechaHoraInicio' | 'creadoEn';

  /** Portal de clienta: solo las citas donde quien consulta es la clienta, sea del rol que sea. */
  @IsOptional()
  @Transform(({ value }) => esPropios(value))
  propios?: boolean;

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
