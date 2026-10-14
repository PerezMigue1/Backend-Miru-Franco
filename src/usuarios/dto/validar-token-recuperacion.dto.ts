import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/** POST /auth/validar-token-recuperacion: sin token, Prisma ignoraría el filtro y daría por bueno cualquier correo. */
export class ValidarTokenRecuperacionDto {
  @IsEmail({}, { message: 'El correo no es válido' })
  @IsNotEmpty({ message: 'El correo es obligatorio' })
  email: string;

  @IsString({ message: 'El token debe ser texto' })
  @IsNotEmpty({ message: 'El token es obligatorio' })
  token: string;
}
