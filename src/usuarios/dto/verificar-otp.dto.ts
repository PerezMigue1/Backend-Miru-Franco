import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class VerificarOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  codigo: string;
}

