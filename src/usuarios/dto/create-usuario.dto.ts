import { IsString, IsEmail, IsOptional, IsBoolean, IsDateString, ValidateNested, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { MAX_TRATAMIENTOS } from '../tratamientos';
import { Type } from 'class-transformer';
import { IsStrongPassword } from '../../common/validators/password.validator';
import { ConsentimientoDatosSensibles } from './consentimiento-datos-sensibles';

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
  @MaxLength(MAX_TRATAMIENTOS)
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

  /** Obligatorio (true) si perfilCapilar.alergias trae texto. No se guarda. */
  @ConsentimientoDatosSensibles()
  consienteDatosSensibles?: boolean;

  /**
   * Cuenta confirmada. Solo se respeta si quien registra tiene sesión de admin (pantalla de admin
   * "nuevo usuario"); en el registro público se ignora y la cuenta nace sin confirmar hasta el OTP.
   */
  @IsBoolean()
  @IsOptional()
  confirmado?: boolean;
}

