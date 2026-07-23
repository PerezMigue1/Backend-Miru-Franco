import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';

@Controller('configuracion')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class ConfiguracionController {
  constructor(private readonly service: ConfiguracionService) {}

  /** Cualquier autenticado — horario y tarifa no son datos sensibles, y el staff los necesita para asistencia. */
  @Get()
  async obtener() {
    return this.service.obtener();
  }

  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async actualizar(@Body() dto: ActualizarConfiguracionDto) {
    return this.service.actualizar(dto);
  }
}
