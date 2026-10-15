import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * POST /auth/me/correo/confirmar: el código de 6 dígitos que llegó al correo nuevo y, en las cuentas sin
 * contraseña (solo Google), también el que llegó al correo actual.
 */
export class ConfirmarCambioCorreoDto {
  @IsString({ message: 'El código tiene 6 dígitos.' })
  @Matches(/^\d{6}$/, { message: 'El código tiene 6 dígitos.' })
  codigo: string;

  @IsOptional()
  @IsString({ message: 'El código de tu correo actual tiene 6 dígitos.' })
  @Matches(/^\d{6}$/, { message: 'El código de tu correo actual tiene 6 dígitos.' })
  codigoActual?: string;
}
