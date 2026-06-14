import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListQuejasDto {
  @IsOptional()
  @IsIn(['abierta', 'en_proceso', 'resuelta', 'cerrada'])
  estado?: 'abierta' | 'en_proceso' | 'resuelta' | 'cerrada';

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
