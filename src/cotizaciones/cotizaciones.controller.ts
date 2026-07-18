import { Body, Controller, Get, Param, Post, Put, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { CotizacionesService } from './cotizaciones.service';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

@Controller('cotizaciones')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class CotizacionesController {
  constructor(private readonly cotizacionesService: CotizacionesService) {}

  @Get()
  @Permisos('servicios:lectura')
  async listar() {
    return this.cotizacionesService.listar();
  }

  @Get(':id')
  @Permisos('servicios:lectura')
  async obtenerPorId(@Param('id') id: string) {
    return this.cotizacionesService.obtenerPorId(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permisos('servicios:escritura')
  async crear(@Body() dto: CreateCotizacionDto) {
    return this.cotizacionesService.crear(dto);
  }

  @Put(':id')
  @Permisos('servicios:escritura')
  async actualizar(@Param('id') id: string, @Body() dto: UpdateCotizacionDto) {
    return this.cotizacionesService.actualizar(Number(id), dto);
  }
}
