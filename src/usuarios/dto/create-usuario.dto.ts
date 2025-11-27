import { IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsObject, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

class PreguntaSeguridadDto {
  @IsString()
  @IsNotEmpty()
  pregunta: string;

  @IsString()
  @IsNotEmpty()
  respuesta: string;
}

class DireccionDto {
  @IsString()
  @IsOptional()
  calle?: string;

  @IsString()
  @IsOptional()
  numero?: string;

  @IsString()
  @IsOptional()
  colonia?: string;

  @IsString()
  @IsOptional()
  ciudad?: string;

  @IsString()
  @IsOptional()
  estado?: string;

  @IsString()
  @IsOptional()
  codigoPostal?: string;

  @IsString()
  @IsOptional()
  referencia?: string;
}

class PerfilCapilarDto {
  @IsString()
  @IsNotEmpty()
  tipoCabello: 'liso' | 'ondulado' | 'rizado';

  @IsString()
  @IsOptional()
  colorNatural?: string;

  @IsString()
  @IsOptional()
  colorActual?: string;

  @IsString()
  @IsOptional()
  productosUsados?: string;

  @IsBoolean()
  @IsOptional()
  tieneAlergias?: boolean;

  @IsString()
  @IsOptional()
  alergias?: string;

  @IsBoolean()
  @IsOptional()
  tratamientosQuimicos?: boolean;

  @IsString()
  @IsOptional()
  tratamientos?: string;
}

export class CreateUsuarioDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  telefono: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsDateString()
  @IsNotEmpty()
  fechaNacimiento: string;

  @ValidateNested()
  @Type(() => PreguntaSeguridadDto)
  @IsNotEmpty()
  preguntaSeguridad: PreguntaSeguridadDto;

  @ValidateNested()
  @Type(() => DireccionDto)
  @IsNotEmpty()
  direccion: DireccionDto;

  @ValidateNested()
  @Type(() => PerfilCapilarDto)
  @IsNotEmpty()
  perfilCapilar: PerfilCapilarDto;

  @IsBoolean()
  @IsNotEmpty()
  aceptaAvisoPrivacidad: boolean;

  @IsBoolean()
  @IsOptional()
  recibePromociones?: boolean;
}

