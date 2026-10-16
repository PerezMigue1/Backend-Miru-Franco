import { Body, Controller, Get, Param, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { RevalidarWebInterceptor } from '../common/services/revalidacion-web';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISO_CONFIGURACION } from '../configuracion-sitio/configuracion-sitio.service';
import { TextosSitioService } from './textos-sitio.service';

/**
 * Admin > Textos del sitio (permiso configuracion:editar; solo admin). Lo público sale dentro de
 * GET /api/configuracion-publica (campo textos). Después de guardar o restaurar se avisa a la web.
 */
@Controller('textos-sitio')
@UseGuards(JwtAuthGuard, PermisosGuard)
@UseInterceptors(RevalidarWebInterceptor)
@Permisos(PERMISO_CONFIGURACION)
export class TextosSitioController {
  constructor(private readonly servicio: TextosSitioService) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Get(':clave/historial')
  historial(@Param('clave') clave: string) {
    return this.servicio.historial(clave);
  }

  @Put(':clave')
  guardar(@Param('clave') clave: string, @Body() cuerpo: { valor?: unknown }, @CurrentUser() user: { id: string }) {
    return this.servicio.guardar(clave, cuerpo?.valor, user.id);
  }

  @Post(':clave/restaurar')
  restaurar(@Param('clave') clave: string, @CurrentUser() user: { id: string }) {
    return this.servicio.restaurar(clave, user.id);
  }
}
