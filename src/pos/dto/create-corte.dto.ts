import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCorteDto {
  @IsDateString()
  fecha: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  efectivoInicial: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  efectivoFinal: number;

  @IsOptional()
  @IsString()
  notas?: string;
}
