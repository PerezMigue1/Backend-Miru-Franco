import { IsString, IsEmail, IsOptional, IsNotEmpty } from 'class-validator';

export class CreatePreguntaDto {
  @IsString()
  @IsNotEmpty()
  pregunta: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  respuesta?: string;
}

