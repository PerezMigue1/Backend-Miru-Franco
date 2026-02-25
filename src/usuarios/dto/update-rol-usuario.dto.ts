import { IsString, IsIn } from 'class-validator';
import { ROLES_PERMITIDOS, RolPermitido } from './update-usuario.dto';

/**
 * DTO para PATCH /usuarios/:id/rol
 * Permite al admin asignar o cambiar solo el rol de un usuario.
 */
export class UpdateRolUsuarioDto {
  @IsString()
  @IsIn(ROLES_PERMITIDOS, {
    message: 'El rol debe ser uno de: cliente, becario, empleado, estilista, admin',
  })
  rol: RolPermitido;
}
