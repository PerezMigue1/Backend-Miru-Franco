import { Body, Controller, Get, Param, Post, Put, Request, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
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

  /**
   * GET /api/cotizaciones/mias: las cotizaciones del usuario en sesión. El usuario sale del token;
   * no se acepta clienteId por query, params ni body. Va antes de `:id` para que no la capture.
   * Sin @Permisos: cualquier usuario autenticado (también el personal desde su portal) puede llamarla,
   * porque SIEMPRE se filtra por req.user.id y nunca expone datos ajenos.
   */
  @Get('mias')
  async listarMias(@Request() req: any) {
    return this.cotizacionesService.listarMias(req.user?.id);
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
