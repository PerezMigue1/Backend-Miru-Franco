import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { ContenidoService, PERMISO_CONTENIDO } from './contenido.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ActualizarPerfilPublicoDto,
  ActualizarPreguntaDto,
  ActualizarPromocionDto,
  CrearPreguntaDto,
  CrearPromocionDto,
  OrdenContenidoDto,
} from './dto/contenido.dto';

const CACHE_PUBLICA = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';

/** Contenido que muestra el sitio, sin sesión y con caché de un minuto (lo publicado se ve sin deploy). */
@Controller('contenido')
export class ContenidoPublicoController {
  constructor(private readonly contenido: ContenidoService) {}

  @Get('promociones')
  @Header('Cache-Control', CACHE_PUBLICA)
  promociones() {
    return this.contenido.promocionesPublicas();
  }

  @Get('preguntas-frecuentes')
  @Header('Cache-Control', CACHE_PUBLICA)
  preguntas() {
    return this.contenido.preguntasPublicas();
  }

  @Get('equipo')
  @Header('Cache-Control', CACHE_PUBLICA)
  equipo() {
    return this.contenido.equipoPublico();
  }
}

/** Admin > Contenido: promociones, preguntas frecuentes y equipo (configuracion:editar, solo admin). */
@Controller('contenido/admin')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos(PERMISO_CONTENIDO)
export class ContenidoAdminController {
  constructor(private readonly contenido: ContenidoService) {}

  @Get('promociones')
  listarPromociones() {
    return this.contenido.listarPromociones();
  }

  @Post('promociones')
  crearPromocion(@Body() dto: CrearPromocionDto, @CurrentUser() usuario: { id: string }) {
    return this.contenido.crearPromocion(dto, usuario?.id);
  }

  @Put('promociones/orden')
  ordenarPromociones(@Body() dto: OrdenContenidoDto) {
    return this.contenido.ordenarPromociones(dto.ids);
  }

  @Patch('promociones/:id')
  actualizarPromocion(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarPromocionDto, @CurrentUser() usuario: { id: string }) {
    return this.contenido.actualizarPromocion(id, dto, usuario?.id);
  }

  @Delete('promociones/:id')
  eliminarPromocion(@Param('id', ParseIntPipe) id: number) {
    return this.contenido.eliminarPromocion(id);
  }

  @Get('preguntas-frecuentes')
  listarPreguntas() {
    return this.contenido.listarPreguntas();
  }

  @Post('preguntas-frecuentes')
  crearPregunta(@Body() dto: CrearPreguntaDto) {
    return this.contenido.crearPregunta(dto);
  }

  @Put('preguntas-frecuentes/orden')
  ordenarPreguntas(@Body() dto: OrdenContenidoDto) {
    return this.contenido.ordenarPreguntas(dto.ids);
  }

  @Patch('preguntas-frecuentes/:id')
  actualizarPregunta(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarPreguntaDto) {
    return this.contenido.actualizarPregunta(id, dto);
  }

  @Delete('preguntas-frecuentes/:id')
  eliminarPregunta(@Param('id', ParseIntPipe) id: number) {
    return this.contenido.eliminarPregunta(id);
  }

  @Get('equipo')
  listarEquipo() {
    return this.contenido.listarEquipo();
  }

  @Put('equipo/orden')
  ordenarEquipo(@Body() dto: OrdenContenidoDto) {
    return this.contenido.ordenarEquipo(dto.ids);
  }

  @Patch('equipo/:id')
  actualizarPerfil(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarPerfilPublicoDto, @CurrentUser() usuario: { id: string }) {
    return this.contenido.actualizarPerfilPublico(id, dto, usuario?.id);
  }
}
