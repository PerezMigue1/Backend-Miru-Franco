import { IsString, IsEmail, IsOptional, IsBoolean, IsDateString, ValidateNested, IsNotEmpty, MinLength, MaxLength, Equals, IsIn, Matches, IsArray, ArrayMaxSize } from 'class-validator';
import { MAX_TRATAMIENTOS } from '../tratamientos';
import { Type } from 'class-transformer';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';
import { IsStrongPassword } from '../../common/validators/password.validator';
import { ConsentimientoDatosSensibles } from './consentimiento-datos-sensibles';
import { DocumentoAceptadoDto } from '../../consentimientos/dto/documento-aceptado.dto';

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
  // Enum TipoCabello de Prisma: otro valor daba 500 al guardar. Opcional (minimización): si viene, del enum.
  @IsOptional()
  @IsString()
  @IsIn(['liso', 'ondulado', 'rizado'], { message: 'El tipo de cabello debe ser liso, ondulado o rizado' })
  tipoCabello?: 'liso' | 'ondulado' | 'rizado';

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
  // Obligatorio porque el sistema lo usa: recuperación de cuenta por SMS (Twilio Verify) y contacto del salón
  // con la clienta (agenda, caja y cotizaciones lo muestran al personal).
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' })
  telefono: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsStrongPassword()
  password: string;

  /**
   * Opcional (minimización): ningún proceso del backend la usa (no hay edad mínima verificada en el servidor ni
   * promociones de cumpleaños). Si viene, debe ser una fecha.
   */
  @IsOptional()
  @IsDateString()
  fechaNacimiento?: string;

  /** Opcional: el admin puede crear la cuenta sin pregunta (queda sin recuperación por pregunta). */
  @ValidateNested()
  @Type(() => PreguntaSeguridadDto)
  @IsOptional()
  preguntaSeguridad?: PreguntaSeguridadDto;

  /** Opcional (minimización): la clienta puede completar su perfil capilar después. */
  @ValidateNested()
  @Type(() => PerfilCapilarDto)
  @IsOptional()
  perfilCapilar?: PerfilCapilarDto;

  // Casillas de consentimiento: booleano real (BooleanoEstricto); "false" o "no" en texto dan 400.
  @BooleanoEstricto()
  @IsBoolean({ message: 'Debes aceptar los términos y condiciones' })
  @Equals(true, { message: 'Debes aceptar los términos y condiciones' })
  aceptaTerminos: boolean;

  // Sin aviso aceptado no se guardan datos (incluidos los de salud del perfil capilar).
  @BooleanoEstricto()
  @IsBoolean({ message: 'Debes aceptar el aviso de privacidad' })
  @Equals(true, { message: 'Debes aceptar el aviso de privacidad' })
  aceptaAvisoPrivacidad: boolean;

  /** Solo la persona puede pedir promociones: en el alta hecha por el admin, true da 400 (usuarios.service). */
  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'El campo recibePromociones debe ser verdadero o falso' })
  recibePromociones?: boolean;

  /**
   * Versiones aceptadas de los documentos (registro DOCUMENTOS_LEGALES de la web: slug, version y hash). Se
   * validan contra versiones_documentos_legales; los obligatorios que no vengan se registran con su versión vigente.
   */
  @IsOptional()
  @IsArray({ message: 'documentos debe ser una lista' })
  @ArrayMaxSize(5, { message: 'Envía como máximo 5 documentos' })
  @ValidateNested({ each: true })
  @Type(() => DocumentoAceptadoDto)
  documentos?: DocumentoAceptadoDto[];

  /** Página donde se marcaron las casillas (la web: "/register"). Se guarda en cada consentimiento del alta. */
  @IsOptional()
  @IsString({ message: 'La ruta de origen debe ser texto' })
  @MaxLength(300, { message: 'La ruta de origen no puede pasar de 300 caracteres' })
  rutaOrigen?: string;

  /** Obligatorio (true) si perfilCapilar.alergias trae texto: lo exige el servicio (400). No se guarda. */
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

