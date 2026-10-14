import { IsString, IsEmail, IsOptional, IsBoolean, IsDateString, ValidateNested, IsNotEmpty, MinLength, MaxLength, Equals, IsIn, Matches } from 'class-validator';
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
  @MaxLength(255, { message: 'La respuesta de seguridad no puede pasar de 255 caracteres' })
  respuesta: string;
}

class PerfilCapilarDto {
  // Enum TipoCabello de Prisma: otro valor daba 500 al guardar.
  @IsString()
  @IsNotEmpty()
  @IsIn(['liso', 'ondulado', 'rizado'], { message: 'El tipo de cabello debe ser liso, ondulado o rizado' })
  tipoCabello: 'liso' | 'ondulado' | 'rizado';

  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'El color natural no puede pasar de 255 caracteres' })
  colorNatural?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'El color actual no puede pasar de 255 caracteres' })
  colorActual?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Los productos usados no pueden pasar de 1000 caracteres' })
  productosUsados?: string;

  @IsBoolean()
  @IsOptional()
  tieneAlergias?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Las alergias no pueden pasar de 1000 caracteres' })
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
  @MaxLength(100, { message: 'El nombre no puede pasar de 100 caracteres' })
  nombre: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  // 10 dígitos (la web y la app ya lo mandan así). Los teléfonos repetidos no se bloquean.
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' })
  telefono: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsStrongPassword()
  password: string;

  @IsDateString()
  @IsNotEmpty()
  fechaNacimiento: string;

  /** Opcional: el admin puede crear la cuenta sin pregunta (queda sin recuperación por pregunta). */
  @ValidateNested()
  @Type(() => PreguntaSeguridadDto)
  @IsOptional()
  preguntaSeguridad?: PreguntaSeguridadDto;

  @ValidateNested()
  @Type(() => PerfilCapilarDto)
  @IsNotEmpty()
  perfilCapilar: PerfilCapilarDto;

  // Sin aviso aceptado no se guardan datos (incluidos los de salud del perfil capilar).
  @IsBoolean()
  @IsNotEmpty()
  @Equals(true, { message: 'Debes aceptar el aviso de privacidad' })
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

