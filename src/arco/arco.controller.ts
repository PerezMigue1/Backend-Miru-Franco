import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { contextoDeRequest } from '../consentimientos/documentos-legales';
import { ArcoService } from './arco.service';
import { ActualizarSolicitudArcoDto, CrearSolicitudArcoDto, ListarSolicitudesArcoQueryDto, OposicionArcoDto } from './dto/arco.dto';

/**
 * Derechos ARCO. La titular (cualquier cuenta con sesión) crea y ve SOLO lo suyo; la bandeja y la ejecución son
 * del admin (clave "*"). Crear solicitudes, oponerse y descargar mis datos llevan límite de peticiones por minuto.
 */
@Controller('arco')
export class ArcoController {
  constructor(private readonly arco: ArcoService) {}

  @Post('solicitudes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, new RateLimitGuard(5, 60000))
  crearSolicitud(@CurrentUser() usuario: { id: string }, @Body() dto: CrearSolicitudArcoDto) {
    return this.arco.crearSolicitud(usuario.id, dto);
  }

  @Get('mias')
  @UseGuards(JwtAuthGuard)
  mias(@CurrentUser() usuario: { id: string }) {
    return this.arco.mias(usuario.id);
  }

  @Get('mis-datos')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(10, 60000))
  misDatos(@CurrentUser() usuario: { id: string }) {
    return this.arco.misDatos(usuario.id);
  }

  @Post('oposicion')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, new RateLimitGuard(5, 60000))
  oposicion(@CurrentUser() usuario: { id: string }, @Body() dto: OposicionArcoDto, @Req() req: Request) {
    return this.arco.oposicion(usuario.id, dto, contextoDeRequest(req));
  }

  @Get('solicitudes')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('*')
  listarAdmin(@Query() query: ListarSolicitudesArcoQueryDto) {
    return this.arco.listarAdmin({ estado: query.estado, vencidas: query.vencidas, page: query.page, limit: query.limit });
  }

  /** El contexto (ip y user agent) queda en las filas de consentimiento que inserta una revocación u oposición atendida. */
  @Patch('solicitudes/:id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('*')
  actualizarAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarSolicitudArcoDto,
    @CurrentUser() admin: { id: string },
    @Req() req: Request,
  ) {
    return this.arco.actualizarAdmin(id, dto, admin.id, contextoDeRequest(req));
  }

  @Post('solicitudes/:id/ejecutar-cancelacion')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('*')
  ejecutarCancelacion(@Param('id', ParseIntPipe) id: number, @CurrentUser() admin: { id: string }) {
    return this.arco.ejecutarCancelacion(id, admin.id);
  }
}
