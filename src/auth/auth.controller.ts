import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GoogleAuthGuard } from '../common/guards/google-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerificarCorreoDto } from '../usuarios/dto/verificar-correo.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {
    console.log('✅ AuthController inicializado');
    console.log('✅ Ruta /api/auth/google debería estar disponible');
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // Este método nunca debería ejecutarse porque Passport redirige automáticamente
    // Pero lo dejamos aquí para que NestJS registre la ruta
    console.log('🔍 Google Auth endpoint llamado - esto no debería ejecutarse');
    return { message: 'Redirigiendo a Google...' };
  }
  
  // Ruta de prueba SIN guard para verificar que el controller funciona
  @Get('test')
  testAuth() {
    console.log('✅ Ruta de prueba /api/auth/test funcionando');
    return { message: 'Auth controller está funcionando correctamente', path: '/api/auth/test' };
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    try {
      console.log('🔍 Google OAuth callback recibido');
      console.log('🔍 Usuario del request:', req.user ? { id: req.user.id, email: req.user.email } : 'NO HAY USUARIO');

      if (!req.user) {
        console.error('❌ Error: req.user es undefined en el callback');
        console.error('❌ Request completo:', {
          url: req.url,
          method: req.method,
          headers: req.headers,
        });
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const cleanFrontendUrl = frontendUrl.replace(/\/+$/, '');
        return res.redirect(`${cleanFrontendUrl}/auth/callback?error=authentication_failed&message=Usuario no autenticado`);
      }

      const result = await this.authService.googleLogin(req.user);
      // Redirigir al frontend con una redirección HTTP real
      console.log('🔍 Redirigiendo a:', result.redirect);
      res.redirect(result.redirect);
    } catch (error: any) {
      console.error('❌ Error en googleAuthRedirect:', error);
      console.error('❌ Stack:', error.stack);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const cleanFrontendUrl = frontendUrl.replace(/\/+$/, '');
      res.redirect(`${cleanFrontendUrl}/auth/callback?error=authentication_failed&message=${encodeURIComponent(error.message)}`);
    }
  }

  @Post('verificar-correo')
  @HttpCode(HttpStatus.OK)
  async verificarCorreo(@Body() verificarCorreoDto: VerificarCorreoDto) {
    return this.authService.verificarCorreoExistente(verificarCorreoDto.correo);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Body() body?: { logoutAll?: boolean }) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return { success: true, message: 'Sesión cerrada' };
    }
    const logoutAll = body?.logoutAll || false;
    return this.authService.logout(token, logoutAll);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentUser() user: any) {
    return this.authService.logoutAll(user.id);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Req() req: any, @CurrentUser() user: any) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return { success: false, message: 'Token no proporcionado' };
    }
    return this.authService.refreshToken(token, user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user);
  }
}

