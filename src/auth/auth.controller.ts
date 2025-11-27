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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerificarCorreoDto } from '../usuarios/dto/verificar-correo.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {
    console.log('✅ AuthController inicializado');
    console.log('✅ Ruta /api/auth/google debería estar disponible');
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth(@Req() req) {
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
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    const result = await this.authService.googleLogin(req.user);
    // Redirigir al frontend con una redirección HTTP real
    res.redirect(result.redirect);
  }

  @Post('verificar-correo')
  @HttpCode(HttpStatus.OK)
  async verificarCorreo(@Body() verificarCorreoDto: VerificarCorreoDto) {
    return this.authService.verificarCorreoExistente(verificarCorreoDto.correo);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user);
  }
}

