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
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { clearAuthCookie, entregarSesion, pideSesionEnCookie } from './auth-cookie';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { GoogleAuthGuard } from '../common/guards/google-auth.guard';
import { SesionOpcionalGuard } from './sesion-opcional.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VerificarCorreoDto } from '../usuarios/dto/verificar-correo.dto';
import { UpdateUsuarioDto } from '../usuarios/dto/update-usuario.dto';
import { LoginDto } from '../usuarios/dto/login.dto';
import { VerificarOtpDto } from '../usuarios/dto/verificar-otp.dto';
import { ReenviarCodigoDto } from '../usuarios/dto/reenviar-codigo.dto';
import { CambiarPasswordDto } from '../usuarios/dto/cambiar-password.dto';
import { CambiarPasswordPerfilDto } from '../usuarios/dto/cambiar-password-perfil.dto';
import { SolicitarCodigoPasswordDto } from '../usuarios/dto/solicitar-codigo-password.dto';
import { RenovarSesionMovilDto } from './dto/renovar-sesion-movil.dto';
import { DEEP_LINK_APP, esCodeVerifier, leerStateApp } from './google-app';
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
    // State firmado por nosotros = login iniciado desde la app; sin él, flujo web de siempre
    const app = leerStateApp(req.query?.state);
    if (app) {
      try {
        if (!req.user) {
          return res.redirect(`${DEEP_LINK_APP}?error=authentication_failed`);
        }
        const result = await this.authService.googleLogin(req.user, { codeChallenge: app.codeChallenge });
        console.log('🔍 Redirigiendo a la app (OAuth callback)');
        return res.redirect(result.redirect);
      } catch {
        // Sin mensajes internos hacia la app
        return res.redirect(`${DEEP_LINK_APP}?error=authentication_failed`);
      }
    }

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

  /**
   * Anónimo: siempre la misma respuesta (no revela si el correo tiene cuenta). Solo con sesión de
   * admin (pantalla admin/usuarios-roles/nuevo) consulta de verdad.
   */
  @Post('verificar-correo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(10, 60000), SesionOpcionalGuard)
  async verificarCorreo(@Body() verificarCorreoDto: VerificarCorreoDto, @CurrentUser() usuario: any) {
    return this.authService.verificarCorreoExistente(verificarCorreoDto.correo, {
      consultaReal: usuario?.rol === 'admin',
    });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: { logoutAll?: boolean; refreshToken?: string },
  ) {
    // rawToken lo fija JwtStrategy con el token que autenticó la petición (Bearer o cookie);
    // leer solo el header Authorization dejaría sin revocar las sesiones con cookie.
    const token: string | undefined = req.rawToken;
    clearAuthCookie(res);
    if (!token) {
      return { success: true, message: 'Sesión cerrada' };
    }
    const logoutAll = body?.logoutAll || false;
    // App móvil: su token de renovación, para cerrar también esa sesión.
    const refreshToken = typeof body?.refreshToken === 'string' && body.refreshToken ? body.refreshToken : undefined;
    return this.authService.logout(token, logoutAll, refreshToken);
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

  /**
   * Paso 1 del cambio de contraseña desde el perfil: con la contraseña actual, envía un código de
   * 6 dígitos al correo de la cuenta (vence en 10 minutos; uno nuevo invalida el anterior).
   */
  @Post('me/password/codigo')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(3, 60000))
  @HttpCode(HttpStatus.OK)
  async solicitarCodigoPassword(@CurrentUser() user: any, @Body() dto: SolicitarCodigoPasswordDto) {
    return this.authService.solicitarCodigoCambioPassword(user.id, dto.actualPassword);
  }

  /**
   * Paso 2: cambia la contraseña con la actual y el código. Cierra todas las sesiones de la cuenta
   * (incluida esta) y avisa por correo: la app debe volver a iniciar sesión.
   */
  @Post('me/password')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(5, 60000))
  @HttpCode(HttpStatus.OK)
  async cambiarPasswordMe(
    @CurrentUser() user: any,
    @Body() dto: CambiarPasswordPerfilDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.authService.cambiarPasswordConCodigo(user.id, dto.actualPassword, dto.nuevaPassword, dto.codigo);
    clearAuthCookie(res);
    return resultado;
  }

  /**
   * Firma de corta duración para subir la foto de perfil directo a Cloudinary (subida firmada).
   * Con la URL resultante se llama a PATCH /auth/me con `foto`.
   */
  @Post('me/foto/firma')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(10, 60000))
  @HttpCode(HttpStatus.OK)
  firmaSubidaFoto(@CurrentUser() user: any) {
    return this.authService.firmaSubidaFoto(user.id);
  }

  // ===== SESIÓN =====

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const enCookie = pideSesionEnCookie(req);
    const resultado = await this.authService.login(loginDto, enCookie);
    return entregarSesion(res, resultado, enCookie);
  }

  /**
   * App móvil de clientas: con el token de renovación entrega un token de acceso nuevo (15 min) y
   * rota el de renovación. Pública: el token de acceso puede estar vencido.
   */
  // Límites: 10/min por sesión y 120/min por IP solo con tokens inexistentes (ver auth/limite-renovacion.ts).
  @Post('movil/renovar')
  @HttpCode(HttpStatus.OK)
  async renovarSesionMovil(@Body() dto: RenovarSesionMovilDto, @Req() req: Request) {
    return this.authService.renovarSesionMovil(dto.refreshToken, req.ip);
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
    @Body() body: { code: string; canal?: string; dispositivo?: string; code_verifier?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.code) {
      throw new UnauthorizedException('Código requerido');
    }
    // Sin DTO: el cuerpo no pasa por ValidationPipe, así que el tipo se comprueba aquí.
    if (typeof body.code !== 'string') {
      throw new UnauthorizedException('Código requerido');
    }
    // PKCE (app móvil): si viene el verifier, debe cumplir RFC 7636 antes de intentar el canje.
    if (body.code_verifier !== undefined && !esCodeVerifier(body.code_verifier)) {
      throw new BadRequestException('code_verifier inválido: debe tener de 43 a 128 caracteres [A-Z a-z 0-9 - . _ ~].');
    }
    const enCookie = pideSesionEnCookie(req);
    const resultado = await this.authService.intercambiarCodigoPorToken(body.code, {
      canal: body.canal,
      dispositivo: body.dispositivo,
      enCookie,
      codeVerifier: body.code_verifier,
    });
    return entregarSesion(res, resultado, enCookie);
  }
}

