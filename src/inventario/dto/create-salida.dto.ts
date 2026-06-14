import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSalidaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  referenciaTipo?: string;

  @IsOptional()
  @IsString()
  referenciaId?: string;
}
