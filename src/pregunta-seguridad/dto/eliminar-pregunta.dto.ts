import { IsOptional, IsString, MaxLength } from 'class-validator';

/** DELETE /pregunta-seguridad/:id (solo admin): cuerpo con la contraseña actual de quien desactiva la pregunta. */
export class EliminarPreguntaDto {
  @IsOptional()
  @MaxLength(256, { message: 'La contraseña actual puede tener como máximo 256 caracteres.' })
  @IsString({ message: 'La contraseña actual debe ser texto.' })
  passwordActual?: string;
}
