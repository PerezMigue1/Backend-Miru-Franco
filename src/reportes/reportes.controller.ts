import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ReportesService } from './reportes.service';
import { RangoFechasDto } from './dto/rango-fechas.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { ComisionesService } from '../comisiones/comisiones.service';
import { solicitanteDe } from '../common/utils/permisos-citas.util';

@Controller('reportes')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos('caja:lectura')
export class ReportesController {
  constructor(
    private readonly reportesService: ReportesService,
    private readonly comisionesService: ComisionesService,
  ) {}

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

  /**
   * GET /api/reportes/comisiones?desde=&hasta= — con comisiones:configurar ve a todo el personal; con
   * comisiones:ver_propias solo lo suyo (el servicio decide el alcance). El @Permisos del método
   * reemplaza al de la clase (caja:lectura).
   */
  @Get('comisiones')
  @Permisos('comisiones:configurar', 'comisiones:ver_propias')
  async comisiones(@Query() query: RangoFechasDto, @Request() req: any) {
    return this.comisionesService.reporte(query.desde, query.hasta, solicitanteDe(req));
  }

  @Get('clientes')
  async clientes(@Query() query: RangoFechasDto) {
    return this.reportesService.clientes(query.desde, query.hasta);
  }
}
