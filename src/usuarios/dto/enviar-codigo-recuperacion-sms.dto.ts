import { IsNotEmpty, IsString } from 'class-validator';

export class EnviarCodigoRecuperacionSmsDto {
  @IsString()
  @IsNotEmpty()
  phone: string;
}
