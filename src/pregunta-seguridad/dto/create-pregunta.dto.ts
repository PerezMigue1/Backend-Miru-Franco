import { IsString, IsEmail, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';

// El último decorador se evalúa primero: si no es texto, el mensaje que llega es el de texto.
export class CreatePreguntaDto {
  @IsString({ message: 'La pregunta de seguridad debe ser texto.' })
  @IsNotEmpty({ message: 'Escribe la pregunta de seguridad.' })
  pregunta: string;

  @IsEmail({}, { message: 'Escribe un correo válido.' })
  @IsOptional()
  email?: string;

  @IsString({ message: 'La respuesta de seguridad debe ser texto.' })
  @IsOptional()
  respuesta?: string;

  /** Obligatoria si la cuenta tiene contraseña (el servicio lo revisa). */
  @IsOptional()
  @MaxLength(256, { message: 'La contraseña actual puede tener como máximo 256 caracteres.' })
  @IsString({ message: 'La contraseña actual debe ser texto.' })
  passwordActual?: string;
}
