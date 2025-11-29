import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { SecurityService } from '../common/services/security.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private usuariosService: UsuariosService,
    private securityService: SecurityService,
    private configService: ConfigService,
  ) {}

  async generateToken(user: any, includeActivity: boolean = true) {
    const now = Math.floor(Date.now() / 1000);
    const payload: any = {
      id: user.id,
      email: user.email,
      jti: crypto.randomBytes(16).toString('hex'), // Token ID único
    };
    
    if (includeActivity) {
      payload.lastActivity = now;
    }
    
    return this.jwtService.sign(payload, { expiresIn: '7d' });
  }

  async googleLogin(user: any) {
    if (!user || !user.id || !user.email) {
      throw new Error('Usuario inválido: falta id o email');
    }

    try {
      const token = await this.generateToken(user);

      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      
      // Limpiar la URL (remover barras finales)
      const cleanFrontendUrl = frontendUrl.replace(/\/+$/, '');
      
      // Redirigir al frontend con el token
      return { 
        redirect: `${cleanFrontendUrl}/auth/callback?token=${token}&success=true`,
        token,
        user,
      };
    } catch (error: any) {
      console.error('❌ Error en googleLogin:', error);
      throw new Error(`Error al generar token: ${error.message}`);
    }
  }

  async logout(token: string) {
    try {
      // Decodificar token para obtener expiración
      const decoded: any = this.jwtService.decode(token);
      if (!decoded || !decoded.exp) {
        throw new UnauthorizedException('Token inválido');
      }
      
      const expiresAt = new Date(decoded.exp * 1000);
      
      // Agregar token a blacklist
      await this.securityService.revokeToken(token, expiresAt);
      
      return {
        success: true,
        message: 'Sesión cerrada correctamente',
      };
    } catch (error) {
      throw new UnauthorizedException('Error al cerrar sesión');
    }
  }

  async refreshToken(oldToken: string, user: any) {
    // Verificar que el token no esté revocado
    const isRevoked = await this.securityService.isTokenRevoked(oldToken);
    if (isRevoked) {
      throw new UnauthorizedException('Token revocado');
    }
    
    // Verificar inactividad
    const decoded: any = this.jwtService.decode(oldToken);
    if (decoded?.lastActivity) {
      const now = Math.floor(Date.now() / 1000);
      const INACTIVITY_TIMEOUT = 15 * 60; // 15 minutos
      if (now - decoded.lastActivity > INACTIVITY_TIMEOUT) {
        throw new UnauthorizedException('Sesión expirada por inactividad');
      }
    }
    
    // Generar nuevo token con actividad actualizada
    const newToken = await this.generateToken(user);
    
    // Revocar token anterior
    if (decoded?.exp) {
      await this.securityService.revokeToken(oldToken, new Date(decoded.exp * 1000));
    }
    
    return {
      success: true,
      token: newToken,
    };
  }

  async verificarCorreoExistente(correo: string) {
    return this.usuariosService.verificarCorreoExistente(correo);
  }

  async getProfile(user: any) {
    return this.usuariosService.obtenerUsuarioPorId(user.id);
  }
}

