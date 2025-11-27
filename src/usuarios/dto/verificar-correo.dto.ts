import { IsEmail, IsNotEmpty } from 'class-validator';

export class VerificarCorreoDto {
  @IsEmail()
  @IsNotEmpty()
  correo: string;
}

