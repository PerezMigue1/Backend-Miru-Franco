import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /auth/me/correo/solicitar: el correo nuevo al que se envía el código. */
export class SolicitarCambioCorreoDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Escribe tu correo nuevo.' })
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  @MaxLength(254, { message: 'El correo puede tener como máximo 254 caracteres.' })
  correoNuevo: string;

  /** Obligatoria si la cuenta tiene contraseña (el servicio lo revisa); las cuentas solo de Google no la mandan. */
  // El último decorador se evalúa primero: si no es texto, el mensaje que llega es el de texto.
  @IsOptional()
  @MaxLength(256, { message: 'La contraseña actual puede tener como máximo 256 caracteres.' })
  @IsString({ message: 'La contraseña actual debe ser texto.' })
  passwordActual?: string;
}
