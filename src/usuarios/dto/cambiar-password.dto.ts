import { IsEmail, IsString, IsNotEmpty, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/password.validator';

export class CambiarPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsStrongPassword()
  nuevaPassword: string;
}

