import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { RevalidarWebInterceptor } from '../common/services/revalidacion-web';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { ActualizarFotoDto, BuscarAutorizacionesDto, CrearFotoDto, FiltrosPanelGaleriaDto, FirmaFotoGaleriaDto, OrdenGaleriaDto } from './dto/galeria.dto';
import { GaleriaService, PERMISO_GALERIA_GESTIONAR, PERMISO_GALERIA_LECTURA } from './galeria.service';

/**
 * Galería del salón.
 * - GET /api/galeria: pública, sin sesión (caché de un minuto).
 * - GET /api/galeria/panel: galeria:lectura o galeria:gestionar (la becaria solo ve).
 * - Firmar una subida, registrar, editar, ordenar, borrar y buscar autorizaciones: galeria:gestionar (admin por '*',
 *   estilista, empleado). Solo se registran fotos subidas desde el panel con una firma propia (nunca una URL).
 */
@Controller('galeria')
@UseInterceptors(RevalidarWebInterceptor)
export class GaleriaController {
  constructor(private readonly galeria: GaleriaService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
  publica() {
    return this.galeria.publica();
  }

  @Get('panel')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos(PERMISO_GALERIA_LECTURA, PERMISO_GALERIA_GESTIONAR)
  panel(@Query() filtros: FiltrosPanelGaleriaDto) {
    return this.galeria.panel(filtros);
  }

  @Get('autorizaciones')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos(PERMISO_GALERIA_GESTIONAR)
  autorizaciones(@Query() query: BuscarAutorizacionesDto) {
    return this.galeria.autorizaciones(query.q);
  }

  /** POST /api/galeria/firma: una firma por foto, con el public_id que genera el servidor (vigente una hora). */
  @Post('firma')
  @UseGuards(JwtAuthGuard, PermisosGuard, new RateLimitGuard(60, 60000))
  @Permisos(PERMISO_GALERIA_GESTIONAR)
  firmar(@Body() dto: FirmaFotoGaleriaDto, @CurrentUser() usuario: { id: string }) {
    return this.galeria.firmar(usuario.id, dto.ilustrativa === true);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos(PERMISO_GALERIA_GESTIONAR)
  crear(@Body() dto: CrearFotoDto, @CurrentUser() usuario: { id: string }) {
    return this.galeria.crear(dto, usuario.id);
  }

  @Put('orden')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos(PERMISO_GALERIA_GESTIONAR)
  reordenar(@Body() dto: OrdenGaleriaDto) {
    return this.galeria.reordenar(dto.ids);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos(PERMISO_GALERIA_GESTIONAR)
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarFotoDto) {
    return this.galeria.actualizar(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos(PERMISO_GALERIA_GESTIONAR)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.galeria.eliminar(id);
  }
}
