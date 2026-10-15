import { Body, Controller, Get, Header, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConfiguracionSitioService, PERMISO_CONFIGURACION } from './configuracion-sitio.service';

/**
 * GET /api/configuracion-publica: datos del salón, redes, horario y textos del sitio, sin sesión. Sin datos
 * sensibles (todo lo que trae ya lo publica el sitio). Caché de un minuto en el servidor y en el navegador.
 */
@Controller('configuracion-publica')
export class ConfiguracionPublicaController {
  constructor(private readonly servicio: ConfiguracionSitioService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
  publica() {
    return this.servicio.publica();
  }
}

/** Admin > Configuración del sitio (permiso configuracion:editar; solo admin). */
@Controller('configuracion-sitio')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos(PERMISO_CONFIGURACION)
export class ConfiguracionSitioController {
  constructor(private readonly servicio: ConfiguracionSitioService) {}

  @Get()
  obtener() {
    return this.servicio.obtenerTodo();
  }

  @Get('historial')
  historial(@Query('clave') clave?: string) {
    return this.servicio.historial(clave);
  }

  @Get('permisos')
  permisos() {
    return this.servicio.permisos();
  }

  @Put('permisos/:rol')
  guardarPermisos(@Param('rol') rol: string, @Body() cuerpo: { claves?: unknown }, @CurrentUser() user: { id: string }) {
    return this.servicio.guardarPermisos(rol, cuerpo?.claves, user.id);
  }

  @Put(':clave')
  guardar(@Param('clave') clave: string, @Body() cuerpo: { valor?: unknown }, @CurrentUser() user: { id: string }) {
    return this.servicio.guardar(clave, cuerpo?.valor, user.id);
  }
}
