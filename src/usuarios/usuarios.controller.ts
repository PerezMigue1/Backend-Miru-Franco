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
  Query,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
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
  async obtenerUsuarios(@Query('q') q?: string) {
    return this.usuariosService.obtenerUsuarios(q);
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
  @Post('registro')
  @HttpCode(HttpStatus.CREATED)
  async registro(@Body() createUsuarioDto: CreateUsuarioDto) {
    return this.usuariosService.crearUsuario(createUsuarioDto);
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

