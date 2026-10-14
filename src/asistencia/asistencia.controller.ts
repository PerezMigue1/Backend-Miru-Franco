import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AsistenciaService } from './asistencia.service';
import { CorregirAsistenciaDto } from './dto/corregir-asistencia.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/** Las rutas propias (sin @Permisos) son solo del personal: RolesGuard deja fuera a la clienta. */
const ROLES_PERSONAL = ['admin', 'estilista', 'empleado', 'becario'];

@Controller('asistencia')
@UseGuards(JwtAuthGuard, PermisosGuard, RolesGuard)
export class AsistenciaController {
  constructor(private readonly service: AsistenciaService) {}

  /** El empleado marca su propia entrada/salida — sin body, sale del token y del estado del día. */
  @Post('marcar')
  @Roles(...ROLES_PERSONAL)
  @HttpCode(HttpStatus.OK)
  async marcar(@CurrentUser() user: { id: string }) {
    return this.service.marcar(user.id);
  }

  /** Las marcas del propio empleado autenticado. */
  @Get('mia')
  @Roles(...ROLES_PERSONAL)
  async listarMias(@CurrentUser() user: { id: string }) {
    return this.service.listarMias(user.id);
  }

  /** Todas las marcas — gestión de la jefa/admin. */
  @Get()
  @Permisos('asistencia:gestionar')
  async listar() {
    return this.service.listar();
  }

  @Patch(':id')
  @Permisos('asistencia:gestionar')
  async corregir(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: string; rol?: string | null },
    @Body() dto: CorregirAsistenciaDto,
  ) {
    return this.service.corregir(id, user.id, dto, user.rol);
  }
}
