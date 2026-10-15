import { IsString, Matches } from 'class-validator';

/** POST /auth/me/correo/confirmar: el código de 6 dígitos que llegó al correo nuevo. */
export class ConfirmarCambioCorreoDto {
  @IsString({ message: 'El código tiene 6 dígitos.' })
  @Matches(/^\d{6}$/, { message: 'El código tiene 6 dígitos.' })
  codigo: string;
}
