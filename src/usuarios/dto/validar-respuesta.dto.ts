import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class ValidarRespuestaDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  respuesta: string;
}

