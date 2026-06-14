import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAjusteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockReal: number;

  @IsString()
  @IsNotEmpty()
  motivo: string;

  @IsOptional()
  @IsString()
  referenciaTipo?: string;

  @IsOptional()
  @IsString()
  referenciaId?: string;
}
