import { IsBoolean } from 'class-validator';

/**
 * DTO para PATCH /usuarios/:id/estado
 * Permite activar o desactivar un usuario (solo admin).
 */
export class UpdateEstadoUsuarioDto {
  @IsBoolean()
  activo: boolean;
}
