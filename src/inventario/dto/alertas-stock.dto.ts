import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AlertasStockDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  umbral?: number = 5;
}
