import { IsOptional, Matches } from 'class-validator';

export class QueryHorasExtraDto {
  /** "YYYY-MM"; si se omite, el service usa el mes actual (hora de México). */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'mes debe tener formato YYYY-MM' })
  mes?: string;
}
