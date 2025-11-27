import { IsEmail, IsNotEmpty } from 'class-validator';

export class ObtenerPreguntaDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

