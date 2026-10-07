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
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { UsuariosService } from './usuarios.service';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { clearAuthCookie } from '../auth/auth-cookie';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { OwnerOrAdminGuard } from '../common/guards/owner-or-admin.guard';
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
  async obtenerUsuarios(
    @Query('q') q?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
  ) {
    return this.usuariosService.obtenerUsuarios(q, incluirInactivos === 'true');
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
  /**
   * Pública. `confirmado` solo se respeta si quien registra tiene sesión de admin (la pantalla de
   * admin "nuevo usuario" usa esta ruta); en el registro público la cuenta nace sin confirmar.
   */
  @Post('registro')
  @UseGuards(SesionOpcionalGuard)
  @HttpCode(HttpStatus.CREATED)
  async registro(@Body() createUsuarioDto: CreateUsuarioDto, @CurrentUser() usuario: any) {
    return this.usuariosService.crearUsuario(createUsuarioDto, { permitirConfirmado: usuario?.rol === 'admin' });
  }

  // ===== ROUTES CON PARÁMETROS DINÁMICOS (al final) =====
  @Get(':id/perfil')
  @UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
  async obtenerPerfilUsuario(@Param('id') id: string) {
    return this.usuariosService.obtenerPerfilUsuario(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
  async obtenerUsuarioPorId(@Param('id') id: string) {
    return this.usuariosService.obtenerUsuarioPorId(id);
  }

  @Put(':id/perfil')
  @UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
  async actualizarPerfilUsuario(
    @Param('id') id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.actualizarPerfilUsuario(id, updateUsuarioDto);
  }

  /**
   * Ruta anterior de la app móvil: ya no cambia la contraseña sin el código del correo. Mismo cuerpo
   * y misma lógica que POST /auth/me/password, y solo para la dueña de la cuenta (ni admin).
   */
  @Put(':id/cambiar-password')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(5, 60000))
  async cambiarPasswordDesdePerfil(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: CambiarPasswordPerfilDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!user?.id || user.id !== id) {
      throw new ForbiddenException('Solo puedes cambiar la contraseña de tu propia cuenta.');
    }
    const resultado = await this.usuariosService.cambiarPasswordConCodigo(id, dto.actualPassword, dto.nuevaPassword, dto.codigo);
    clearAuthCookie(res);
    return resultado;
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

