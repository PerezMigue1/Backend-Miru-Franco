import { IsEmail, IsString, IsNotEmpty, IsOptional, IsIn, MaxLength } from 'class-validator';
import { sanitizeInput } from '../../common/utils/security.util';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  /**
   * "movil": la app de clientas pide sesión de 30 días con renovación (ver src/auth/sesion-movil.ts).
   * Solo aplica en modo Bearer y con rol cliente; en cualquier otro caso se ignora.
   */
  @IsOptional()
  @IsIn(['movil'])
  canal?: 'movil';

  /** Nombre del dispositivo para la sesión móvil (opcional). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  dispositivo?: string;

  // Sanitizar email al crear instancia
  constructor(data?: Partial<LoginDto>) {
    if (data) {
      this.email = data.email ? sanitizeInput(data.email.toLowerCase().trim()) : '';
      this.password = data.password || '';
    }
  }
}
