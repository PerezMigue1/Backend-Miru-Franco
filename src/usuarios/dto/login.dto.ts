import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { sanitizeInput } from '../../common/utils/security.util';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  // Sanitizar email al crear instancia
  constructor(data?: Partial<LoginDto>) {
    if (data) {
      this.email = data.email ? sanitizeInput(data.email.toLowerCase().trim()) : '';
      this.password = data.password || '';
    }
  }
}

