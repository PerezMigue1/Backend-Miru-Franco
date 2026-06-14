import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateQuejaDto {
  @IsOptional()
  @IsString()
  asunto?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsIn(['abierta', 'en_proceso', 'resuelta', 'cerrada'])
  estado?: 'abierta' | 'en_proceso' | 'resuelta' | 'cerrada';

  @IsOptional()
  @IsDateString()
  resueltaEn?: string;
}
