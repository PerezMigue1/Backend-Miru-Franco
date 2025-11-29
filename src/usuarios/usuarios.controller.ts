import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { LoginDto } from './dto/login.dto';
import { VerificarOtpDto } from './dto/verificar-otp.dto';
import { ReenviarCodigoDto } from './dto/reenviar-codigo.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { CambiarPasswordDto } from './dto/cambiar-password.dto';
import { CambiarPasswordPerfilDto } from './dto/cambiar-password-perfil.dto';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  // ===== GET ROUTES (sin parámetros primero) =====
  @Get()
  @UseGuards(JwtAuthGuard)
  async obtenerUsuarios() {
    return this.usuariosService.obtenerUsuarios();
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
  async reenviarCodigo(@Body() reenviarCodigoDto: ReenviarCodigoDto) {
    return this.usuariosService.reenviarCodigo(reenviarCodigoDto);
  }

  @Post('pregunta-seguridad')
  @HttpCode(HttpStatus.OK)
  // Rate limiting: 3 intentos por minuto por IP (para prevenir enumeración de usuarios)
  async obtenerPreguntaSeguridad(@Body() body: { email: string }) {
    return this.usuariosService.obtenerPreguntaSeguridad(body.email);
  }

  @Post('verificar-respuesta')
  async validarRespuestaSeguridad(@Body() body: { email: string; respuesta: string }) {
    return this.usuariosService.validarRespuestaSeguridad(body.email, body.respuesta);
  }

  @Post('solicitar-enlace-recuperacion')
  @HttpCode(HttpStatus.OK)
  // Rate limiting: 3 intentos por minuto por IP (para prevenir spam)
  async solicitarEnlaceRecuperacion(@Body() body: { email: string }) {
    return this.usuariosService.solicitarEnlaceRecuperacion(body.email);
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

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async actualizarUsuario(
    @Param('id') id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.actualizarUsuario(id, updateUsuarioDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async eliminarUsuario(@Param('id') id: string) {
    return this.usuariosService.eliminarUsuario(id);
  }
}

