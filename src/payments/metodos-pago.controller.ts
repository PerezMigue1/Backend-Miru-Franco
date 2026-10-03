import {
  Controller,
  Delete,
  GoneException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MetodosPagoService } from './metodos-pago.service';

/**
 * Tarjetas / métodos tokenizados guardados (perfil + checkout).
 * Base: /api/payments/metodos-pago. Solo listar y borrar las que ya existían (crear y editar: 410).
 */
@Controller('payments/metodos-pago')
@UseGuards(JwtAuthGuard)
export class MetodosPagoController {
  constructor(private readonly service: MetodosPagoService) {}

  @Get()
  listar(
    @CurrentUser() user: { id: string },
    @Query('usuarioId') usuarioId?: string,
  ) {
    return this.service.listar(user.id, usuarioId);
  }

  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.obtenerPorId(id, user.id);
  }

  /**
   * Retirado: con Mercado Pago Checkout Pro el sitio no guarda datos de tarjeta. Sin @Body a propósito:
   * el cuerpo ni se valida ni se lee. Las tarjetas que ya existían se pueden listar y borrar.
   */
  @Post()
  crear() {
    throw new GoneException('Ya no se guardan tarjetas: el pago en línea se hace en Mercado Pago.');
  }

  /** Retirado por el mismo motivo que crear(): no se escriben datos de tarjeta. */
  @Patch(':id')
  actualizar() {
    throw new GoneException('Ya no se guardan tarjetas: el pago en línea se hace en Mercado Pago.');
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(id, user.id);
  }
}
