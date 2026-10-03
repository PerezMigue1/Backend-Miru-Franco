import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PagosEnLineaService } from './pagos-en-linea.service';
import { CrearPreferenciaDto } from './dto/crear-preferencia.dto';
import { validarFirmaMercadoPago } from './firma-mercadopago';

@Controller('pagos-en-linea/mercadopago')
export class PagosEnLineaController {
  constructor(private readonly servicio: PagosEnLineaService) {}

  /** La clienta pide pagar su pedido: devuelve la URL de Mercado Pago a la que se le redirige. */
  @Post('preferencia')
  @UseGuards(JwtAuthGuard)
  crearPreferencia(@Body() dto: CrearPreferenciaDto, @CurrentUser() user: { id: string }) {
    return this.servicio.crearPreferencia(dto.pedidoId, user.id);
  }

  /** Estado real del pago para la pantalla de confirmación. */
  @Get('estado/:pedidoId')
  @UseGuards(JwtAuthGuard)
  estado(@Param('pedidoId', ParseIntPipe) pedidoId: number, @CurrentUser() user: { id: string }) {
    return this.servicio.consultarEstado(pedidoId, user.id);
  }

  /**
   * Notificaciones de Mercado Pago (público). Firma inválida → 401. El cuerpo no se usa para decidir:
   * solo el id, y el pago se consulta en la API de Mercado Pago. Un error al consultarla responde 5xx
   * para que Mercado Pago reintente.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: Request,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query('type') tipoQuery: string | undefined,
    @Body() cuerpo: { type?: string; data?: { id?: string | number } } | undefined,
  ) {
    const dataIdQuery = req.query['data.id'];
    const dataId = typeof dataIdQuery === 'string' && dataIdQuery ? dataIdQuery : cuerpo?.data?.id != null ? String(cuerpo.data.id) : undefined;
    const valida = validarFirmaMercadoPago({ xSignature, xRequestId, dataId, secreto: process.env.MP_WEBHOOK_SECRET ?? '' });
    if (!valida || !dataId) throw new UnauthorizedException('Firma inválida');

    const tipo = tipoQuery ?? cuerpo?.type;
    if (tipo !== 'payment') return { ok: true };
    await this.servicio.procesarPago(dataId);
    return { ok: true };
  }
}
