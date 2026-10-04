import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { ComisionesService } from './comisiones.service';
import { CambiarRecibeComisionesDto, GuardarComisionDto } from './dto/guardar-comision.dto';

/** Configuración de comisiones fijas por servicio y de quién las recibe (solo comisiones:configurar). */
@Controller('comisiones')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class ComisionesController {
  constructor(private readonly comisionesService: ComisionesService) {}

  @Get('servicios')
  @Permisos('comisiones:configurar')
  listarServicios() {
    return this.comisionesService.listarServicios();
  }

  @Put('servicios/:servicioId')
  @Permisos('comisiones:configurar')
  guardarComision(@Param('servicioId', ParseIntPipe) servicioId: number, @Body() dto: GuardarComisionDto, @Request() req: any) {
    return this.comisionesService.guardarComision(servicioId, dto, req.user.id);
  }

  @Delete('servicios/:servicioId')
  @Permisos('comisiones:configurar')
  eliminarComision(@Param('servicioId', ParseIntPipe) servicioId: number) {
    return this.comisionesService.eliminarComision(servicioId);
  }

  @Get('personal')
  @Permisos('comisiones:configurar')
  listarPersonal() {
    return this.comisionesService.listarPersonal();
  }

  @Put('personal/:usuarioId')
  @Permisos('comisiones:configurar')
  cambiarRecibeComisiones(@Param('usuarioId', ParseUUIDPipe) usuarioId: string, @Body() dto: CambiarRecibeComisionesDto) {
    return this.comisionesService.cambiarRecibeComisiones(usuarioId, dto.recibeComisiones);
  }
}
