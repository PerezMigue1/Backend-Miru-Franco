import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class CambiarPasswordPerfilDto {
  @IsString()
  @IsNotEmpty()
  actualPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  nuevaPassword: string;
}

