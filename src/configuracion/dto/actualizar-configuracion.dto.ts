import { IsInt, IsOptional, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';

const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ActualizarConfiguracionDto {
  @IsOptional()
  @Matches(REGEX_HORA, { message: 'entradaLunesViernes debe tener formato HH:mm' })
  entradaLunesViernes?: string;

  @IsOptional()
  @Matches(REGEX_HORA, { message: 'salidaLunesViernes debe tener formato HH:mm' })
  salidaLunesViernes?: string;

  @IsOptional()
  @Matches(REGEX_HORA, { message: 'entradaSabado debe tener formato HH:mm' })
  entradaSabado?: string;

  @IsOptional()
  @Matches(REGEX_HORA, { message: 'salidaSabado debe tener formato HH:mm' })
  salidaSabado?: string;

  /** Domingo puede venir explícitamente null (para "borrar" la config del domingo). */
  @IsOptional()
  @Matches(REGEX_HORA, { message: 'entradaDomingo debe tener formato HH:mm' })
  entradaDomingo?: string | null;

  @IsOptional()
  @Matches(REGEX_HORA, { message: 'salidaDomingo debe tener formato HH:mm' })
  salidaDomingo?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  margenGraciaMinutos?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  tarifaHoraExtra?: number;
}
