import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PUT /pregunta-seguridad/:id (solo admin): gestión del catálogo preguntas_disponibles.
 * pregunta renombra (u obliga al crear con id nuevo) y activa activa/desactiva la opción.
 */
export class UpdatePreguntaDto {
  @IsString({ message: 'La pregunta de seguridad debe ser texto.' })
  @IsOptional()
  pregunta?: string;

  @IsBoolean({ message: 'El campo activa debe ser verdadero o falso.' })
  @IsOptional()
  activa?: boolean;

  /** Contraseña actual de quien hace el cambio (obligatoria si su cuenta tiene contraseña). */
  @IsOptional()
  @MaxLength(256, { message: 'La contraseña actual puede tener como máximo 256 caracteres.' })
  @IsString({ message: 'La contraseña actual debe ser texto.' })
  passwordActual?: string;
}
