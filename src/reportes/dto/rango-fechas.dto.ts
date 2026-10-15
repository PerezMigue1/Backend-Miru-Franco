import { IsDateString, IsOptional } from 'class-validator';

export class RangoFechasDto {
  @IsOptional()
  @IsDateString({}, { message: 'La fecha "desde" no es válida (usa AAAA-MM-DD)' })
  desde?: string;

  @IsOptional()
  @IsDateString({}, { message: 'La fecha "hasta" no es válida (usa AAAA-MM-DD)' })
  hasta?: string;
}
