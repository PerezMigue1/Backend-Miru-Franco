import { IsString, IsEmail, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdatePreguntaDto {
  @IsString()
  @IsOptional()
  pregunta?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  respuesta?: string;
}

