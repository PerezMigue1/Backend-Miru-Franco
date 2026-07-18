import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportesService } from './reportes.service';
import { RangoFechasDto } from './dto/rango-fechas.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

@Controller('reportes')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos('caja:lectura')
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  @Get('ventas')
  async ventas(@Query() query: RangoFechasDto) {
    return this.reportesService.ventas(query.desde, query.hasta);
  }

  @Get('servicios')
  async servicios(@Query() query: RangoFechasDto) {
    return this.reportesService.servicios(query.desde, query.hasta);
  }

  @Get('inventario')
  async inventario() {
    return this.reportesService.inventario();
  }

  @Get('clientes')
  async clientes(@Query() query: RangoFechasDto) {
    return this.reportesService.clientes(query.desde, query.hasta);
  }
}
