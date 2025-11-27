import { IsString, IsOptional, IsBoolean, IsDateString, IsObject } from 'class-validator';

export class UpdateUsuarioDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsDateString()
  @IsOptional()
  fechaNacimiento?: string;

  @IsObject()
  @IsOptional()
  direccion?: any;

  @IsObject()
  @IsOptional()
  perfilCapilar?: any;

  @IsBoolean()
  @IsOptional()
  recibePromociones?: boolean;
}

