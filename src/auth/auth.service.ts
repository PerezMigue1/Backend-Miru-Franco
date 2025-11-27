import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private usuariosService: UsuariosService,
    private configService: ConfigService,
  ) {}

  async googleLogin(user: any) {
    const token = this.jwtService.sign(
      { id: user.id, email: user.email },
      { expiresIn: '7d' },
    );

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    
    // Redirigir al frontend con el token
    return { 
      redirect: `${frontendUrl}/auth/callback?token=${token}&success=true`,
      token,
      user,
    };
  }

  async verificarCorreoExistente(correo: string) {
    return this.usuariosService.verificarCorreoExistente(correo);
  }

  async getProfile(user: any) {
    return this.usuariosService.obtenerUsuarioPorId(user.id);
  }
}

