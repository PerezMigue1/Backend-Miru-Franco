import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../../common/guards/permisos.guard';
import { solicitanteDe } from '../../common/utils/permisos-citas.util';
import { AnticiposCitasService } from './anticipos-citas.service';
import { METODOS_ANTICIPO_SALON, RUTA_RETORNO_APP, deepLinkAnticipoApp, type MetodoAnticipoSalon } from './anticipos.util';

export class RegistrarAnticipoDto {
  @IsIn(METODOS_ANTICIPO_SALON)
  metodo: MetodoAnticipoSalon;
}

/**
 * Anticipo de citas. La preferencia y el estado los usa la dueña de la cita (cualquier rol, desde el
 * portal); cobrar, reembolsar y retener son del personal según sus claves de permisos_rol.
 */
@Controller()
@UseGuards(JwtAuthGuard, PermisosGuard)
export class AnticiposCitasController {
  constructor(private readonly anticipos: AnticiposCitasService) {}

  /**
   * POST /api/pagos-en-linea/citas/:id/preferencia: URL de Mercado Pago para pagar el anticipo.
   * Con ?origen=app, Mercado Pago regresa a /api/pagos-en-linea/citas/retorno-app en lugar de la web.
   */
  @Post('pagos-en-linea/citas/:id/preferencia')
  crearPreferencia(@Param('id', ParseIntPipe) id: number, @Query('origen') origen: string | undefined, @Request() req: any) {
    return this.anticipos.crearPreferencia(id, req.user.id, new Date(), origen === 'app');
  }

  /** GET /api/pagos-en-linea/citas/:id/estado: estado real del anticipo (consulta a Mercado Pago). */
  @Get('pagos-en-linea/citas/:id/estado')
  // Cualquier rol pasa (la dueña ve la suya); las claves cargadas permiten al personal con escritura ver las demás.
  @Permisos('citas:propia', 'citas:propias', 'citas:asignadas', 'citas:escritura')
  estado(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.anticipos.consultarEstado(id, solicitanteDe(req));
  }

  /** POST /api/citas/:id/anticipo: cobro del anticipo en el salón (efectivo, transferencia o tarjeta). */
  @Post('citas/:id/anticipo')
  @HttpCode(HttpStatus.CREATED)
  @Permisos('caja:escritura', 'ventas:escritura')
  registrarEnSalon(@Param('id', ParseIntPipe) id: number, @Body() dto: RegistrarAnticipoDto, @Request() req: any) {
    return this.anticipos.registrarEnSalon(id, dto.metodo, req.user.id);
  }

  /** POST /api/citas/:id/anticipo/reembolsar: cancela el salón o se revisó un pago en revisión. */
  @Post('citas/:id/anticipo/reembolsar')
  @HttpCode(HttpStatus.OK)
  @Permisos('caja:escritura')
  reembolsar(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.anticipos.reembolsar(id, req.user.id);
  }

  /** POST /api/citas/:id/anticipo/retener: el salón se queda el anticipo de un pago en revisión. */
  @Post('citas/:id/anticipo/retener')
  @HttpCode(HttpStatus.OK)
  @Permisos('caja:escritura')
  retener(@Param('id', ParseIntPipe) id: number) {
    return this.anticipos.retener(id);
  }
}

/**
 * GET /api/pagos-en-linea/citas/retorno-app?citaId=<id>: Mercado Pago regresa aquí cuando el anticipo se
 * pagó desde la app. Pública (el navegador llega sin sesión) y siempre al deep link fijo con solo el id de
 * la cita: los parámetros que agrega Mercado Pago no se reenvían; la app consulta el estado real con /estado.
 */
@Controller()
export class RetornoAppAnticipoController {
  @Get(RUTA_RETORNO_APP)
  retornoApp(@Query('citaId') citaId: string | undefined, @Res() res: Response) {
    const id = typeof citaId === 'string' && /^[1-9]\d*$/.test(citaId) ? Number(citaId) : NaN;
    if (!Number.isSafeInteger(id)) throw new BadRequestException('citaId inválido');
    res.redirect(302, deepLinkAnticipoApp(id));
  }
}
