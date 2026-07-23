import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { HorasExtraService } from './horas-extra.service';
import { QueryHorasExtraDto } from './dto/query-horas-extra.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('horas-extra')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class HorasExtraController {
  constructor(private readonly service: HorasExtraService) {}

  /** Todos los empleados — gestión de la jefa/admin. Solo lectura, sin tabla propia. */
  @Get()
  @Permisos('asistencia:gestionar')
  async listar(@Query() query: QueryHorasExtraDto) {
    return this.service.listar(query.mes);
  }

  /** Las horas extra del propio empleado autenticado. */
  @Get('mias')
  async mias(@CurrentUser() user: { id: string }, @Query() query: QueryHorasExtraDto) {
    return this.service.mias(user.id, query.mes);
  }
}
