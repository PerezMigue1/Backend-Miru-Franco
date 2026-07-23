import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SolicitudesPermisoService } from './solicitudes-permiso.service';
import { CreateSolicitudPermisoDto } from './dto/create-solicitud-permiso.dto';
import { ResolverSolicitudPermisoDto } from './dto/resolver-solicitud-permiso.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('solicitudes-permiso')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class SolicitudesPermisoController {
  constructor(private readonly service: SolicitudesPermisoService) {}

  /** Todas las solicitudes — gestión de la jefa/admin. */
  @Get()
  @Permisos('solicitudes:gestionar')
  async listar() {
    return this.service.listar();
  }

  /** Las solicitudes del propio empleado autenticado. */
  @Get('mias')
  async listarMias(@CurrentUser() user: { id: string }) {
    return this.service.listarMias(user.id);
  }

  /** El solicitante siempre sale del token, nunca del body. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crear(@CurrentUser() user: { id: string }, @Body() dto: CreateSolicitudPermisoDto) {
    return this.service.crear(user.id, dto);
  }

  @Patch(':id/resolver')
  @Permisos('solicitudes:gestionar')
  async resolver(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ResolverSolicitudPermisoDto,
  ) {
    return this.service.resolver(Number(id), user.id, dto);
  }
}
