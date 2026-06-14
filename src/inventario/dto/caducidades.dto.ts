import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CaducidadesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dias?: number = 30;
}
