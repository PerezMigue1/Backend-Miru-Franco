import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const backendUrl = configService.get<string>('BACKEND_URL') || 'http://localhost:3001';
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    
    // Limpiar la URL (remover barras finales)
    const cleanBackendUrl = backendUrl.replace(/\/+$/, '');
    const callbackURL = `${cleanBackendUrl}/api/auth/google/callback`;
    
    // Log para debugging
    console.log('🔍 Google Strategy - Backend URL:', cleanBackendUrl);
    console.log('🔍 Google Strategy - Callback URL:', callbackURL);
    console.log('🔍 Google Strategy - Client ID configured:', !!clientID);
    
    // Inicializar con valores por defecto si no están configurados (para evitar errores de inicialización)
    super({
      clientID: clientID || 'dummy-client-id',
      clientSecret: clientSecret || 'dummy-client-secret',
      callbackURL: callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    try {
      const email = profile.emails[0].value.toLowerCase();
      const { id, displayName, photos } = profile;
      
      console.log('🔍 Google OAuth - Validando usuario:', email);

      let usuario = await this.prisma.usuario.findFirst({
        where: {
          OR: [
            { email },
            { googleId: id },
          ],
        },
      });

      if (!usuario) {
        // Crear nuevo usuario con Google (sin relaciones requeridas)
        usuario = await this.prisma.usuario.create({
          data: {
            nombre: displayName,
            email,
            googleId: id,
            foto: photos[0]?.value || null,
            telefono: null,
            password: null,
            fechaNacimiento: null,
            aceptaAvisoPrivacidad: true,
            recibePromociones: false,
            confirmado: true,
            activo: true,
          },
        });
      } else {
        // Actualizar Google ID y foto si no existen
        const updateData: any = {};
        if (!usuario.googleId) {
          updateData.googleId = id;
          updateData.confirmado = true;
        }
        if (!usuario.foto && photos[0]?.value) {
          updateData.foto = photos[0].value;
        }
        if (Object.keys(updateData).length > 0) {
          usuario = await this.prisma.usuario.update({
            where: { id: usuario.id },
            data: updateData,
          });
        }
      }

      console.log('✅ Google OAuth - Usuario validado:', usuario.id);
      done(null, usuario);
    } catch (error) {
      console.error('❌ Google OAuth - Error validando usuario:', error);
      done(error, null);
    }
  }
}

