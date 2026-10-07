import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/password.validator';

/**
 * POST /auth/me/password y PUT /usuarios/:id/cambiar-password: la contraseña solo cambia con la
 * actual y el código que llegó al correo (POST /auth/me/password/codigo).
 */
export class CambiarPasswordPerfilDto {
  @IsString()
  @IsNotEmpty()
  actualPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @IsStrongPassword()
  nuevaPassword: string;

  // El formato (6 dígitos) lo revisa el servicio para responder CODIGO_INVALIDO como a un código incorrecto.
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  codigo: string;
}
