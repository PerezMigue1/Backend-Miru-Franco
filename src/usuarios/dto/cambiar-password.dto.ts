import { IsEmail, IsString, IsNotEmpty, MinLength } from 'class-validator';

export class CambiarPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  nuevaPassword: string;
}

