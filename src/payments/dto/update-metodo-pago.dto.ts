import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMetodoPagoDto {
  @IsBoolean()
  @IsOptional()
  esPredeterminada?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  etiqueta?: string;
}
