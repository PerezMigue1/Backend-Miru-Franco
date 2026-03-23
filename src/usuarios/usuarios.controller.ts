import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { LoginDto } from './dto/login.dto';
import { VerificarOtpDto } from './dto/verificar-otp.dto';
import { ReenviarCodigoDto } from './dto/reenviar-codigo.dto';
import { EnviarCodigoRecuperacionSmsDto } from './dto/enviar-codigo-recuperacion-sms.dto';
import { VerificarCodigoRecuperacionSmsDto } from './dto/verificar-codigo-recuperacion-sms.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { CambiarPasswordDto } from './dto/cambiar-password.dto';
import { CambiarPasswordPerfilDto } from './dto/cambiar-password-perfil.dto';
import { UpdateEstadoUsuarioDto } from './dto/update-estado-usuario.dto';
import { UpdateRolUsuarioDto } from './dto/update-rol-usuario.dto';
import { ROLES_CATALOGO } from '../common/constants/roles.constants';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  // ===== GET ROUTES (sin parámetros primero) =====
  /**
   * Obtener todos los usuarios
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async obtenerUsuarios() {
    return this.usuariosService.obtenerUsuarios();
  }

  /**
   * Catálogo de roles (id, nombre, descripción, permisos) para el front (admin panel, selects).
   * Público para que el front pueda construir formularios sin estar logueado.
   */
  @Get('roles')
  async listarRoles() {
    return {
      success: true,
      data: ROLES_CATALOGO.map(({ id, valor, nombre, descripcion, permisos }) => ({
        id,
        valor,
        nombre,
        descripcion,
        permisos,
      })),
    };
  }

  // ===== POST ROUTES (rutas específicas ANTES de rutas con parámetros) =====
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crearUsuario(@Body() createUsuarioDto: CreateUsuarioDto) {
    return this.usuariosService.crearUsuario(createUsuarioDto);
  }

  @Post('registro')
  @HttpCode(HttpStatus.CREATED)
  async registro(@Body() createUsuarioDto: CreateUsuarioDto) {
    // Alias para compatibilidad con frontend - DEBE ir antes de rutas con parámetros
    return this.usuariosService.crearUsuario(createUsuarioDto);
  }

  @Post('registrar')
  @HttpCode(HttpStatus.CREATED)
  async registrar(@Body() createUsuarioDto: CreateUsuarioDto) {
    return this.usuariosService.crearUsuario(createUsuarioDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Rate limiting: 5 intentos por minuto por IP
  async login(@Body() loginDto: LoginDto) {
    return this.usuariosService.login(loginDto);
  }

  @Post('verificar-otp')
  @HttpCode(HttpStatus.OK)
  async verificarOTP(@Body() verificarOtpDto: VerificarOtpDto) {
    return this.usuariosService.verificarOTP(verificarOtpDto);
  }

  @Post('reenviar-codigo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000)) // 3 intentos por minuto (60000 ms)
  async reenviarCodigo(@Body() reenviarCodigoDto: ReenviarCodigoDto) {
    return this.usuariosService.reenviarCodigo(reenviarCodigoDto);
  }

  @Post('pregunta-seguridad')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000)) // 3 intentos por minuto (60000 ms) - previene enumeración de usuarios
  async obtenerPreguntaSeguridad(@Body() body: { email: string }) {
    return this.usuariosService.obtenerPreguntaSeguridad(body.email);
  }

  @Post('verificar-respuesta')
  async validarRespuestaSeguridad(@Body() body: { email: string; respuesta: string }) {
    return this.usuariosService.validarRespuestaSeguridad(body.email, body.respuesta);
  }

  @Post('solicitar-enlace-recuperacion')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000)) // 3 intentos por minuto (60000 ms) - previene spam
  async solicitarEnlaceRecuperacion(@Body() body: { email: string }) {
    return this.usuariosService.solicitarEnlaceRecuperacion(body.email);
  }

  @Post('enviar-codigo-recuperacion-sms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000)) // 3 intentos por minuto (60000 ms)
  async enviarCodigoRecuperacionSMS(@Body() body: EnviarCodigoRecuperacionSmsDto) {
    return this.usuariosService.enviarCodigoRecuperacionSMS(body.phone);
  }

  @Post('verificar-codigo-recuperacion-sms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(5, 60000)) // 5 intentos por minuto (60000 ms)
  async verificarCodigoRecuperacionSMS(@Body() body: VerificarCodigoRecuperacionSmsDto) {
    return this.usuariosService.verificarCodigoRecuperacionSMS(body.phone, body.codigo);
  }

  @Post('validar-token-recuperacion')
  @HttpCode(HttpStatus.OK)
  async validarTokenRecuperacion(@Body() body: { email: string; token: string }) {
    return this.usuariosService.validarTokenRecuperacion(body.email, body.token);
  }

  @Post('cambiar-password')
  async cambiarPassword(@Body() cambiarPasswordDto: CambiarPasswordDto) {
    return this.usuariosService.cambiarPassword(
      cambiarPasswordDto.email,
      cambiarPasswordDto.token,
      cambiarPasswordDto.nuevaPassword,
    );
  }

  // ===== ROUTES CON PARÁMETROS DINÁMICOS (al final) =====
  @Get(':id/perfil')
  @UseGuards(JwtAuthGuard)
  async obtenerPerfilUsuario(@Param('id') id: string) {
    return this.usuariosService.obtenerPerfilUsuario(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async obtenerUsuarioPorId(@Param('id') id: string) {
    return this.usuariosService.obtenerUsuarioPorId(id);
  }

  @Put(':id/perfil')
  @UseGuards(JwtAuthGuard)
  async actualizarPerfilUsuario(
    @Param('id') id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.actualizarPerfilUsuario(id, updateUsuarioDto);
  }

  @Put(':id/cambiar-password')
  @UseGuards(JwtAuthGuard)
  async cambiarPasswordDesdePerfil(
    @Param('id') id: string,
    @Body() cambiarPasswordPerfilDto: CambiarPasswordPerfilDto,
  ) {
    return this.usuariosService.cambiarPasswordDesdePerfil(
      id,
      cambiarPasswordPerfilDto.actualPassword,
      cambiarPasswordPerfilDto.nuevaPassword,
    );
  }

  /**
   * Actualizar usuario por ID (incluye nombre, teléfono, rol, etc.)
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async actualizarUsuario(
    @Param('id') id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
    @Req() req: { user?: { id: string } },
  ) {
    if (req.user?.id === id && updateUsuarioDto.rol !== undefined && updateUsuarioDto.rol !== 'admin') {
      throw new ForbiddenException('No puedes quitarte el rol de administrador');
    }
    return this.usuariosService.actualizarUsuario(id, updateUsuarioDto);
  }

  /**
   * Cambiar rol del usuario (usuario | admin)
   * ✅ Solo para administradores. Body: { "rol": "usuario" | "admin" }
   */
  @Patch(':id/rol')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async cambiarRolUsuario(
    @Param('id') id: string,
    @Body() dto: UpdateRolUsuarioDto,
    @Req() req: { user?: { id: string } },
  ) {
    if (req.user?.id === id && dto.rol !== 'admin') {
      throw new ForbiddenException('No puedes quitarte el rol de administrador');
    }
    return this.usuariosService.cambiarRolUsuario(id, dto.rol);
  }

  /**
   * Cambiar estado activo/inactivo del usuario
   * ✅ Solo para administradores (rol = 'admin')
   * Body: { "activo": true | false }
   */
  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async cambiarEstadoUsuario(
    @Param('id') id: string,
    @Body() dto: UpdateEstadoUsuarioDto,
  ) {
    return this.usuariosService.cambiarEstadoUsuario(id, dto.activo);
  }

  /**
   * Eliminar usuario por ID (borrado lógico: activo = false)
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async eliminarUsuario(@Param('id') id: string) {
    return this.usuariosService.eliminarUsuario(id);
  }
}

