import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /auth/movil/renovar */
export class RenovarSesionMovilDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken: string;
}
