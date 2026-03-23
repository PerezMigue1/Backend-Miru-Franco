import { IsNotEmpty, IsString } from 'class-validator';

export class VerificarCodigoRecuperacionSmsDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  codigo: string;
}
