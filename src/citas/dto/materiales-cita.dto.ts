import { ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MaterialItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number;
}

export class MaterialesCitaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MaterialItemDto)
  materiales: MaterialItemDto[];
}
