import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/** Datos de Google de una persona que todavía no tiene cuenta (req.user del callback en ese caso). */
export interface RegistroGooglePendiente {
  registroGooglePendiente: true;
  googleId: string;
  email: string;
  nombre: string;
  foto: string | null;
}

export function esRegistroGooglePendiente(usuario: unknown): usuario is RegistroGooglePendiente {
  return !!usuario && typeof usuario === 'object' && (usuario as { registroGooglePendiente?: unknown }).registroGooglePendiente === true;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

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
      // Asegurar que siempre se muestre la pantalla de selección
      passReqToCallback: false,
    });
    
    console.log('✅ Google Strategy - Configurado con prompt: select_account');
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
      

      let usuario = await this.prisma.usuario.findFirst({
        where: {
          OR: [
            { email },
            { googleId: id },
          ],
        },
      });

      if (!usuario) {
        // Cuenta nueva: aquí NO se crea, ni para la web ni para la app. Se crea al aceptar términos y aviso en
        // /auth/completar-registro (POST /auth/google/completar), con el token de origen web o app.
        const pendiente: RegistroGooglePendiente = {
          registroGooglePendiente: true,
          googleId: id,
          email,
          nombre: displayName,
          foto: photos?.[0]?.value || null,
        };
        done(null, pendiente);
        return;
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
    } catch (error: any) {
      this.logger.error(`Google OAuth - Error validando usuario (${error?.name ?? 'Error'}, código ${error?.code ?? '-'})`);
      done(error, null);
    }
  }
}

