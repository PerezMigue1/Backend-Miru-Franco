import { IsString, IsEmail, IsOptional, IsBoolean, IsDateString, ValidateNested, IsNotEmpty, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { IsStrongPassword } from '../../common/validators/password.validator';

class PreguntaSeguridadDto {
  @IsString()
  @IsNotEmpty()
  pregunta: string;

  @IsString()
  @IsNotEmpty()
  respuesta: string;
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
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsStrongPassword()
  password: string;

  @IsDateString()
  @IsNotEmpty()
  fechaNacimiento: string;

  @ValidateNested()
  @Type(() => PreguntaSeguridadDto)
  @IsNotEmpty()
  preguntaSeguridad: PreguntaSeguridadDto;

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

  /** Cuenta confirmada (para usuarios creados por admin; omitir en registro público) */
  @IsBoolean()
  @IsOptional()
  confirmado?: boolean;
}

