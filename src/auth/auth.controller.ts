import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { clearAuthCookie, entregarSesion, pideSesionEnCookie } from './auth-cookie';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { GoogleAuthGuard } from '../common/guards/google-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerificarCorreoDto } from '../usuarios/dto/verificar-correo.dto';
import { UpdateUsuarioDto } from '../usuarios/dto/update-usuario.dto';
import { LoginDto } from '../usuarios/dto/login.dto';
import { VerificarOtpDto } from '../usuarios/dto/verificar-otp.dto';
import { ReenviarCodigoDto } from '../usuarios/dto/reenviar-codigo.dto';
import { CambiarPasswordDto } from '../usuarios/dto/cambiar-password.dto';
import { EnviarCodigoRecuperacionSmsDto } from '../usuarios/dto/enviar-codigo-recuperacion-sms.dto';
import { VerificarCodigoRecuperacionSmsDto } from '../usuarios/dto/verificar-codigo-recuperacion-sms.dto';
import { sanitizeForLogOutput } from '../common/utils/security.util';

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
      console.log('🔍 Usuario del request:', req.user ? req.user.id : 'NO HAY USUARIO');

      if (!req.user) {
        console.error('❌ Error: req.user es undefined en el callback');
        // No loguear headers ni URL cruda (log injection / datos sensibles)
        console.error('❌ Request (resumido):', {
          method: req.method,
          path: sanitizeForLogOutput(String(req.url ?? '').split('?')[0], 2048),
          headerCount: Object.keys(req.headers ?? {}).length,
        });
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const cleanFrontendUrl = frontendUrl.replace(/\/+$/, '');
        return res.redirect(`${cleanFrontendUrl}/auth/callback?error=authentication_failed&message=Usuario no autenticado`);
      }

      const result = await this.authService.googleLogin(req.user);
      // Redirigir al frontend con una redirección HTTP real
      // NO loggear la URL completa que contiene el código (por seguridad)
      console.log('🔍 Redirigiendo al frontend (OAuth callback)');
      res.redirect(result.redirect);
    } catch (error: any) {
      console.error('❌ Error en googleAuthRedirect:', error?.message ?? error);
      console.error('❌ Stack:', sanitizeForLogOutput(error?.stack, 4000));
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
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: { logoutAll?: boolean },
  ) {
    // rawToken lo fija JwtStrategy con el token que autenticó la petición (Bearer o cookie);
    // leer solo el header Authorization dejaría sin revocar las sesiones con cookie.
    const token: string | undefined = req.rawToken;
    clearAuthCookie(res);
    if (!token) {
      return { success: true, message: 'Sesión cerrada' };
    }
    const logoutAll = body?.logoutAll || false;
    return this.authService.logout(token, logoutAll);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentUser() user: any, @Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res);
    return this.authService.logoutAll(user.id);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Req() req: any,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token: string | undefined = req.rawToken;
    if (!token) {
      return { success: false, message: 'Token no proporcionado' };
    }
    const resultado = await this.authService.refreshToken(token, user);
    return entregarSesion(res, resultado, req.authTransport === 'cookie');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user);
  }

  /**
   * Actualiza el perfil del usuario autenticado (parcial).
   * Body puede incluir `foto`: string (URL) o `null` para quitarla (ver `Usuario.foto` en Prisma).
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async patchMe(@CurrentUser() user: any, @Body() dto: UpdateUsuarioDto) {
    return this.authService.updateProfileMe(user.id, dto);
  }

  // ===== SESIÓN =====

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.authService.login(loginDto);
    return entregarSesion(res, resultado, pideSesionEnCookie(req));
  }

  // ===== VERIFICACIÓN DE CUENTA =====

  @Post('verificar-otp')
  @HttpCode(HttpStatus.OK)
  async verificarOTP(@Body() verificarOtpDto: VerificarOtpDto) {
    return this.authService.verificarOTP(verificarOtpDto);
  }

  @Post('reenviar-codigo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async reenviarCodigo(@Body() reenviarCodigoDto: ReenviarCodigoDto) {
    return this.authService.reenviarCodigo(reenviarCodigoDto);
  }

  // ===== RECUPERACIÓN DE CONTRASEÑA =====

  @Post('pregunta-seguridad')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async obtenerPreguntaSeguridad(@Body() body: { email: string }) {
    return this.authService.obtenerPreguntaSeguridad(body.email);
  }

  @Post('verificar-respuesta')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async verificarRespuesta(@Body() body: { email: string; respuesta: string }) {
    return this.authService.verificarRespuestaSeguridad(body.email, body.respuesta);
  }

  @Post('solicitar-enlace-recuperacion')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async solicitarEnlaceRecuperacion(@Body() body: { email: string }) {
    return this.authService.solicitarEnlaceRecuperacion(body.email);
  }

  @Post('enviar-codigo-recuperacion-sms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async enviarCodigoRecuperacionSMS(@Body() body: EnviarCodigoRecuperacionSmsDto) {
    return this.authService.enviarCodigoRecuperacionSMS(body.phone);
  }

  @Post('verificar-codigo-recuperacion-sms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(5, 60000))
  async verificarCodigoRecuperacionSMS(@Body() body: VerificarCodigoRecuperacionSmsDto) {
    return this.authService.verificarCodigoRecuperacionSMS(body.phone, body.codigo);
  }

  @Post('validar-token-recuperacion')
  @HttpCode(HttpStatus.OK)
  async validarTokenRecuperacion(@Body() body: { email: string; token: string }) {
    return this.authService.validarTokenRecuperacion(body.email, body.token);
  }

  @Post('cambiar-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async cambiarPassword(@Body() cambiarPasswordDto: CambiarPasswordDto) {
    return this.authService.cambiarPassword(
      cambiarPasswordDto.email,
      cambiarPasswordDto.token,
      cambiarPasswordDto.nuevaPassword,
    );
  }

  /**
   * Intercambia un código temporal de OAuth por un token JWT
   * Endpoint seguro que no expone el token en la URL
   */
  @Post('exchange-code')
  @HttpCode(HttpStatus.OK)
  async exchangeCode(
    @Body() body: { code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.code) {
      throw new UnauthorizedException('Código requerido');
    }
    const resultado = await this.authService.intercambiarCodigoPorToken(body.code);
    return entregarSesion(res, resultado, pideSesionEnCookie(req));
  }
}

