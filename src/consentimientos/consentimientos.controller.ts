import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { ConsentimientosService } from './consentimientos.service';
import { contextoDeRequest } from './documentos-legales';
import {
  ExportarConsentimientosQueryDto,
  ListarConsentimientosAdminQueryDto,
  RegistrarConsentimientosDto,
} from './dto/registrar-consentimientos.dto';

/**
 * Evidencia de consentimientos. Solo rutas para registrar y consultar: no hay PUT, PATCH ni DELETE (la tabla es
 * de solo inserción; revocar es registrar otra fila con accion "revocado").
 */
@Controller('consentimientos')
export class ConsentimientosController {
  constructor(private readonly consentimientos: ConsentimientosService) {}

  /** Con sesión liga la cuenta; sin sesión exige visitanteId. ip, user agent y fecha los pone el backend. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(new RateLimitGuard(30, 60000), SesionOpcionalGuard)
  registrar(@Body() dto: RegistrarConsentimientosDto, @CurrentUser() usuario: { id?: string } | null, @Req() req: Request) {
    return this.consentimientos.registrar(dto, { usuarioId: usuario?.id ?? null }, contextoDeRequest(req));
  }

  @Get('mios')
  @UseGuards(JwtAuthGuard)
  mios(@CurrentUser() usuario: { id: string }) {
    return this.consentimientos.mios(usuario.id);
  }

  @Get('pendientes')
  @UseGuards(JwtAuthGuard)
  pendientes(@CurrentUser() usuario: { id: string }) {
    return this.consentimientos.pendientes(usuario.id);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('*')
  listarAdmin(@Query() query: ListarConsentimientosAdminQueryDto) {
    return this.consentimientos.listarAdmin({ q: query.q, page: query.page, limit: query.limit });
  }

  @Get('admin/export')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('*')
  async exportarCsv(@Query() query: ExportarConsentimientosQueryDto, @Res() res: Response): Promise<void> {
    const { contenido, nombreArchivo } = await this.consentimientos.exportarCsv({ usuarioId: query.usuarioId });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.send(contenido);
  }
}
