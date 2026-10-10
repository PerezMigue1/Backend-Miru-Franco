import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { UpdateUsuarioDto } from '../usuarios/dto/update-usuario.dto';
import { LoginDto } from '../usuarios/dto/login.dto';
import { VerificarOtpDto } from '../usuarios/dto/verificar-otp.dto';
import { ReenviarCodigoDto } from '../usuarios/dto/reenviar-codigo.dto';
import { SecurityService } from '../common/services/security.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { JWT_TTL_SEGUNDOS, VENTANA_REFRESH_SEGUNDOS } from './jwt-ttl';
import { crearFirmaSubidaFoto } from './firma-cloudinary';
import { SesionesMovilesService } from './sesiones-moviles.service';
import { CANAL_MOVIL, esTokenMovil } from './sesion-movil';
import { DEEP_LINK_APP, challengeDeVerifier, codigoGuardadoApp, esCodeVerifier } from './google-app';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private usuariosService: UsuariosService,
    private securityService: SecurityService,
    private configService: ConfigService,
    private sesionesMoviles?: SesionesMovilesService,
  ) {}

  /** Canal movil solo en modo Bearer y para clientas; en cualquier otro caso se ignora sin error. */
  private emiteSesionMovil(canal: unknown, enCookie: boolean, rol: unknown): boolean {
    return canal === CANAL_MOVIL && !enCookie && rol === 'cliente' && !!this.sesionesMoviles;
  }

  async generateToken(user: any, includeActivity: boolean = true) {
    const now = Math.floor(Date.now() / 1000);
    const payload: any = {
      id: user.id,
      email: user.email,
      jti: crypto.randomBytes(16).toString('hex'), // Token ID único
      iat: now, // Issued at time (para logout global)
    };
    
    if (includeActivity) {
      payload.lastActivity = now;
    }
    
    return this.jwtService.sign(payload, { expiresIn: JWT_TTL_SEGUNDOS }); // misma vigencia que el login
  }

  async googleLogin(user: any, opciones: { codeChallenge?: string } = {}) {
    if (!user || !user.id || !user.email) {
      throw new Error('Usuario inválido: falta id o email');
    }

    try {
      // Generar token JWT
      const token = await this.generateToken(user);

      // Generar código temporal único y seguro (Authorization Code Flow)
      const codigo = crypto.randomBytes(32).toString('hex');
      
      // Almacenar código con token asociado (expira en 5 minutos)
      const expiraEn = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos
      // App: el código se guarda unido a su challenge (PKCE); a la app solo va `codigo`
      await this.prisma.codigoOAuth.create({
        data: {
          codigo: opciones.codeChallenge ? codigoGuardadoApp(codigo, opciones.codeChallenge) : codigo,
          token,
          expiraEn,
          usado: false,
        },
      });

      if (opciones.codeChallenge) {
        return { redirect: `${DEEP_LINK_APP}?code=${codigo}` };
      }

      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      
      // Limpiar la URL (remover barras finales)
      const cleanFrontendUrl = frontendUrl.replace(/\/+$/, '');
      
      // Redirigir al frontend con el código (NO el token) - Seguro
      return { 
        redirect: `${cleanFrontendUrl}/auth/callback?code=${codigo}&success=true`,
        // NO retornar token en la respuesta (solo para uso interno)
      };
    } catch (error: any) {
      // NO loggear el token, solo el error
      console.error('❌ Error en googleLogin:', error.message);
      throw new Error(`Error al generar token: ${error.message}`);
    }
  }

  /**
   * Intercambia un código temporal por un token JWT (Authorization Code Flow)
   * El código solo puede usarse una vez y expira en 5 minutos
   */
  async intercambiarCodigoPorToken(
    codigo: string,
    opciones: { canal?: unknown; dispositivo?: unknown; enCookie?: boolean; codeVerifier?: string } = {},
  ) {
    // Llave de búsqueda. El código de la app va en la base como `codigo.challenge` (PKCE): solo se
    // encuentra con el verifier correcto. Un verifier incorrecto da otra llave, que no existe.
    let clave: string;
    if (opciones.codeVerifier !== undefined) {
      // Ya lo valida el controller; se repite por defensa.
      if (!esCodeVerifier(opciones.codeVerifier)) {
        throw new UnauthorizedException('Código inválido');
      }
      clave = codigoGuardadoApp(codigo, challengeDeVerifier(opciones.codeVerifier));
    } else {
      // Sin verifier no se acepta una llave con punto: así un código de app no se canjea
      // presentando `codigo.challenge` directamente.
      if (codigo.includes('.')) {
        throw new UnauthorizedException('Código inválido');
      }
      clave = codigo;
    }

    // Buscar el código
    const codigoOAuth = await this.prisma.codigoOAuth.findUnique({
      where: { codigo: clave },
    });

    if (!codigoOAuth) {
      throw new UnauthorizedException('Código inválido');
    }

    // Verificar si ya fue usado
    if (codigoOAuth.usado) {
      throw new UnauthorizedException('Código ya utilizado');
    }

    // Verificar si expiró
    if (codigoOAuth.expiraEn < new Date()) {
      // Limpiar código expirado
      await this.prisma.codigoOAuth.delete({
        where: { codigo: clave },
      });
      throw new UnauthorizedException('Código expirado');
    }

    // Marcar como usado (single-use). Update condicional: si dos canjes llegan a la vez,
    // solo uno encuentra `usado: false`; el otro no marca nada y se rechaza.
    const marcado = await this.prisma.codigoOAuth.updateMany({
      where: { codigo: clave, usado: false },
      data: { usado: true },
    });
    if (marcado.count === 0) {
      throw new UnauthorizedException('Código ya utilizado');
    }

    // Actualizar última actividad del usuario asociado al token
    try {
      const decoded: any = this.jwtService.decode(codigoOAuth.token);
      if (decoded?.id) {
        await this.securityService.updateLastActivity(decoded.id);
      }
    } catch (error) {
      // No bloquear el flujo de login por errores al actualizar actividad
      console.error('Error actualizando última actividad en OAuth:', error);
    }

    // App móvil (Google): sesión de 30 días con renovación, solo para clientas en modo Bearer.
    if (opciones.canal === CANAL_MOVIL && !opciones.enCookie && this.sesionesMoviles) {
      const decoded: any = this.jwtService.decode(codigoOAuth.token);
      const usuario = decoded?.id
        ? await this.prisma.usuario.findUnique({ where: { id: decoded.id }, select: { id: true, email: true, rol: true, activo: true } })
        : null;
      if (usuario?.activo && this.emiteSesionMovil(opciones.canal, false, usuario.rol)) {
        const movil = await this.sesionesMoviles.emitir({ id: usuario.id, email: usuario.email }, opciones.dispositivo);
        return { success: true, ...movil };
      }
    }

    // Retornar el token
    return {
      success: true,
      token: codigoOAuth.token,
    };
  }

  /**
   * Limpia códigos OAuth expirados o usados (ejecutar periódicamente)
   */
  async limpiarCodigosExpirados() {
    await this.prisma.codigoOAuth.deleteMany({
      where: {
        OR: [
          { usado: true },
          { expiraEn: { lt: new Date() } },
        ],
      },
    });
  }

  async logout(token: string, _logoutAll: boolean = false, refreshToken?: string) {
    try {
      // Decodificar token para obtener información
      const decoded: any = this.jwtService.decode(token);
      if (!decoded || !decoded.exp) {
        throw new UnauthorizedException('Token inválido');
      }

      // SIEMPRE hacer logout global:
      // - Revocar todos los tokens del usuario (cierra sesión en todos los dispositivos)
      // - Cumple con el requisito de que cerrar sesión en un dispositivo invalida las demás sesiones
      await this.securityService.revokeAllUserTokens(decoded.id);

      // App móvil: además, la sesión de ese token de renovación (solo si es de la misma cuenta).
      // Va después y aparte: si falla, el cierre global ya quedó hecho.
      if (refreshToken && this.sesionesMoviles) {
        try {
          await this.sesionesMoviles.revocarPorToken(refreshToken, decoded.id);
        } catch {
          // revokeAllUserTokens ya dejó la sesión sin renovación posible (tokensRevocadosDesde).
        }
      }

      return {
        success: true,
        message: 'Todas las sesiones han sido cerradas correctamente',
      };
    } catch (error) {
      throw new UnauthorizedException('Error al cerrar sesión');
    }
  }

  async logoutAll(userId: string) {
    try {
      // Revocar todos los tokens del usuario
      await this.securityService.revokeAllUserTokens(userId);
      
      return {
        success: true,
        message: 'Todas las sesiones han sido cerradas correctamente',
      };
    } catch (error) {
      throw new UnauthorizedException('Error al cerrar todas las sesiones');
    }
  }

  async refreshToken(oldToken: string, user: any) {
    // El token de la app móvil se renueva con su token de renovación, no aquí.
    if (esTokenMovil(this.jwtService.decode(oldToken))) {
      throw new BadRequestException({
        message: 'La app renueva su sesión con POST /api/auth/movil/renovar.',
        code: 'USA_RENOVAR_MOVIL',
      });
    }

    // Verificar que el token no esté revocado
    const isRevoked = await this.securityService.isTokenRevoked(oldToken);
    if (isRevoked) {
      throw new UnauthorizedException('Token revocado');
    }
    
    // Verificar inactividad
    const decoded: any = this.jwtService.decode(oldToken);
    if (decoded?.lastActivity) {
      const now = Math.floor(Date.now() / 1000);
      if (now - decoded.lastActivity > VENTANA_REFRESH_SEGUNDOS) {
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

  async verificarCorreoExistente(correo: string, opciones: { consultaReal?: boolean } = {}) {
    return this.usuariosService.verificarCorreoExistente(correo, opciones);
  }

  /**
   * GET /auth/me: además del perfil, incluye `permisos` (claves de permisos_rol para el
   * rol del usuario) para que el frontend arme el sidebar y los guards de página sin
   * listas de roles hardcodeadas. No se firma en el JWT a propósito: se resuelve en cada
   * request (misma consulta que PermisosGuard) para que un cambio en permisos_rol aplique
   * al instante, sin esperar a que expire/rote el token.
   */
  async getProfile(user: any) {
    const resultado = await this.usuariosService.obtenerUsuarioPorId(user.id);
    const rol = resultado?.data?.rol;
    const permisoRol = rol
      ? await this.prisma.permisoRol.findUnique({ where: { rol }, select: { claves: true } })
      : null;
    // tienePassword: la app ofrece "cambiar contraseña" solo si la cuenta tiene una. El hash no sale de aquí.
    const cuenta = await this.prisma.usuario.findUnique({ where: { id: user.id }, select: { password: true } });
    return {
      ...resultado,
      data: {
        ...resultado.data,
        permisos: permisoRol?.claves ?? [],
        tienePassword: !!cuenta?.password,
      },
    };
  }

  /** POST /auth/me/password/codigo */
  async solicitarCodigoCambioPassword(userId: string, actualPassword: string) {
    return this.usuariosService.solicitarCodigoCambioPassword(userId, actualPassword);
  }

  /** POST /auth/me/password */
  async cambiarPasswordConCodigo(userId: string, actualPassword: string, nuevaPassword: string, codigo: string) {
    return this.usuariosService.cambiarPasswordConCodigo(userId, actualPassword, nuevaPassword, codigo);
  }

  /** PATCH /auth/me: mismos campos permitidos que PUT usuarios/:id/perfil (incl. `foto`). */
  async updateProfileMe(userId: string, dto: UpdateUsuarioDto) {
    return this.usuariosService.actualizarPerfilUsuario(userId, dto);
  }

  /** POST /auth/me/foto/firma: firma para subir la foto de perfil del usuario a Cloudinary. */
  firmaSubidaFoto(userId: string) {
    return { success: true, data: crearFirmaSubidaFoto(userId) };
  }

  // ===== Delegados: sesión y recuperación de contraseña =====

  /**
   * Con canal "movil" (Bearer y rol cliente) la respuesta lleva el token de acceso corto de la app,
   * refreshToken y refreshExpiraEn. En cualquier otro caso, la sesión de siempre.
   */
  async login(loginDto: LoginDto, enCookie = false) {
    const resultado = await this.usuariosService.login(loginDto);
    if (!this.emiteSesionMovil(loginDto.canal, enCookie, resultado?.usuario?.rol)) {
      return resultado;
    }
    const movil = await this.sesionesMoviles!.emitir(
      { id: resultado.usuario.id, email: resultado.usuario.email },
      loginDto.dispositivo,
    );
    return { ...resultado, ...movil };
  }

  /** POST /auth/movil/renovar */
  renovarSesionMovil(refreshToken: string, ip?: string) {
    return this.sesionesMoviles!.renovar(refreshToken, ip);
  }

  verificarOTP(verificarOtpDto: VerificarOtpDto) {
    return this.usuariosService.verificarOTP(verificarOtpDto);
  }

  reenviarCodigo(reenviarCodigoDto: ReenviarCodigoDto) {
    return this.usuariosService.reenviarCodigo(reenviarCodigoDto);
  }

  obtenerPreguntaSeguridad(email: string) {
    return this.usuariosService.obtenerPreguntaSeguridad(email);
  }

  verificarRespuestaSeguridad(email: string, respuesta: string) {
    return this.usuariosService.validarRespuestaSeguridad(email, respuesta);
  }

  solicitarEnlaceRecuperacion(email: string) {
    return this.usuariosService.solicitarEnlaceRecuperacion(email);
  }

  enviarCodigoRecuperacionSMS(phone: string) {
    return this.usuariosService.enviarCodigoRecuperacionSMS(phone);
  }

  verificarCodigoRecuperacionSMS(phone: string, codigo: string) {
    return this.usuariosService.verificarCodigoRecuperacionSMS(phone, codigo);
  }

  validarTokenRecuperacion(email: string, token: string) {
    return this.usuariosService.validarTokenRecuperacion(email, token);
  }

  cambiarPassword(email: string, token: string, nuevaPassword: string) {
    return this.usuariosService.cambiarPassword(email, token, nuevaPassword);
  }
}

