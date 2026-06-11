import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class TruncateTableDto {
  @IsString()
  tabla: string;

  @IsOptional()
  @IsBoolean()
  restartIdentity?: boolean = true;

  @IsOptional()
  @IsBoolean()
  cascade?: boolean = false;
}
