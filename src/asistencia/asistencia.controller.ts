import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AsistenciaService } from './asistencia.service';
import { CorregirAsistenciaDto } from './dto/corregir-asistencia.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('asistencia')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class AsistenciaController {
  constructor(private readonly service: AsistenciaService) {}

  /** El empleado marca su propia entrada/salida — sin body, sale del token y del estado del día. */
  @Post('marcar')
  @HttpCode(HttpStatus.OK)
  async marcar(@CurrentUser() user: { id: string }) {
    return this.service.marcar(user.id);
  }

  /** Las marcas del propio empleado autenticado. */
  @Get('mia')
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
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CorregirAsistenciaDto,
  ) {
    return this.service.corregir(Number(id), user.id, dto);
  }
}
