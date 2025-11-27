import { IsEmail, IsObject, IsNotEmpty } from 'class-validator';

export class VerificarRespuestaDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsObject()
  @IsNotEmpty()
  answers: Record<string, string>;
}

