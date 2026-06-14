import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListCortesDto {
  @IsOptional()
  desde?: string;

  @IsOptional()
  hasta?: string;

  @IsOptional()
  @IsUUID()
  cajeroId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
