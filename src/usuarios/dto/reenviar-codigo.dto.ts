import { IsEmail, IsNotEmpty } from 'class-validator';

export class ReenviarCodigoDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

