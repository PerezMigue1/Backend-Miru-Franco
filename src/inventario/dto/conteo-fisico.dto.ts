import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ConteoItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockReal: number;
}

export class ConteoFisicoDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConteoItemDto)
  items: ConteoItemDto[];

  @IsOptional()
  @IsString()
  motivo?: string;
}
