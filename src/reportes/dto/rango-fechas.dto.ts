import { IsOptional, IsString } from 'class-validator';

export class RangoFechasDto {
  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;
}
