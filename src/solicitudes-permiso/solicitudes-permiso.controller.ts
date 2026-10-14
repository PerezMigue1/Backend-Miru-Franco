import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SolicitudesPermisoService } from './solicitudes-permiso.service';
import { CreateSolicitudPermisoDto } from './dto/create-solicitud-permiso.dto';
import { ResolverSolicitudPermisoDto } from './dto/resolver-solicitud-permiso.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/** Las rutas propias (sin @Permisos) son solo del personal: RolesGuard deja fuera a la clienta. */
const ROLES_PERSONAL = ['admin', 'estilista', 'empleado', 'becario'];

@Controller('solicitudes-permiso')
@UseGuards(JwtAuthGuard, PermisosGuard, RolesGuard)
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
  @Roles(...ROLES_PERSONAL)
  async listarMias(@CurrentUser() user: { id: string }) {
    return this.service.listarMias(user.id);
  }

  /** El solicitante siempre sale del token, nunca del body. */
  @Post()
  @Roles(...ROLES_PERSONAL)
  @HttpCode(HttpStatus.CREATED)
  async crear(@CurrentUser() user: { id: string }, @Body() dto: CreateSolicitudPermisoDto) {
    return this.service.crear(user.id, dto);
  }

  @Patch(':id/resolver')
  @Permisos('solicitudes:gestionar')
  async resolver(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: string; rol?: string | null },
    @Body() dto: ResolverSolicitudPermisoDto,
  ) {
    return this.service.resolver(id, user.id, dto, user.rol);
  }
}
