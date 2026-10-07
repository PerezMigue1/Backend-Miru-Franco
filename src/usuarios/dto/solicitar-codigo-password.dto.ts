import { IsString, IsNotEmpty } from 'class-validator';

/** POST /auth/me/password/codigo: la contraseña actual, para enviar el código al correo. */
export class SolicitarCodigoPasswordDto {
  @IsString()
  @IsNotEmpty()
  actualPassword: string;
}
