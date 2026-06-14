import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PermisosService } from './permisos.service';
import { UpdatePermisosRolDto } from './dto/update-permisos-rol.dto';

@Controller('permisos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PermisosController {
  constructor(private readonly permisosService: PermisosService) {}

  @Get()
  listar() {
    return this.permisosService.listar();
  }

  @Get('rol/:rol')
  listarPorRol(@Param('rol') rol: string) {
    return this.permisosService.listarPorRol(rol);
  }

  @Put('rol/:rol')
  actualizarPorRol(@Param('rol') rol: string, @Body() dto: UpdatePermisosRolDto) {
    return this.permisosService.actualizarPorRol(rol, dto);
  }
}
