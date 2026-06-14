import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class UpdatePermisosRolDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  claves: string[];
}
