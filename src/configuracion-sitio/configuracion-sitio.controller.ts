import { Body, Controller, Get, Header, Param, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { RevalidarWebInterceptor } from '../common/services/revalidacion-web';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConfiguracionSitioService, PERMISO_CONFIGURACION, PERMISO_HORARIO } from './configuracion-sitio.service';

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
@UseInterceptors(RevalidarWebInterceptor)
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
  guardar(@Param('clave') clave: string, @Body() cuerpo: { valor?: unknown; actualizadoEn?: string }, @CurrentUser() user: { id: string }) {
    return this.servicio.guardar(clave, cuerpo?.valor, user.id, { versionBase: typeof cuerpo?.actualizadoEn === 'string' ? cuerpo.actualizadoEn : null });
  }
}

/**
 * Operaciones > Horario y días inhábiles (permiso horario:editar, o admin). Usa la misma validación e historial que
 * Admin > Configuración del sitio; los días inhábiles se guardan dentro de las reglas sin tocar las demás.
 */
@Controller('operacion-sitio')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos(PERMISO_HORARIO)
@UseInterceptors(RevalidarWebInterceptor)
export class OperacionSitioController {
  constructor(private readonly servicio: ConfiguracionSitioService) {}

  @Get()
  obtener() {
    return this.servicio.operacion();
  }

  @Put('horario')
  guardarHorario(@Body() cuerpo: { valor?: unknown; actualizadoEn?: string }, @CurrentUser() user: { id: string }) {
    return this.servicio.guardar('horario', cuerpo?.valor, user.id, { versionBase: typeof cuerpo?.actualizadoEn === 'string' ? cuerpo.actualizadoEn : null });
  }

  @Put('dias-inhabiles')
  guardarDiasInhabiles(@Body() cuerpo: { diasInhabiles?: unknown; actualizadoEn?: string }, @CurrentUser() user: { id: string }) {
    return this.servicio.guardarDiasInhabiles(cuerpo?.diasInhabiles, user.id, typeof cuerpo?.actualizadoEn === 'string' ? cuerpo.actualizadoEn : null);
  }
}
