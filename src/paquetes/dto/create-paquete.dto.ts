import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaqueteDto {
  @IsString()
  tipo_evento: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  servicios_vinculados?: string[];

  @IsNumber()
  @Type(() => Number)
  precio_especial: number;
}
