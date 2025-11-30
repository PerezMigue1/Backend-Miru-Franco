import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReenviarCodigoDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  metodoVerificacion?: 'email' | 'sms' = 'email'; // Método de verificación: email o sms
}

