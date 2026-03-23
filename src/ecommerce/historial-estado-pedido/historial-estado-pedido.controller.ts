import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HistorialEstadoPedidoService } from './historial-estado-pedido.service';
import { CreateHistorialEstadoPedidoDto } from './dto/create-historial-estado-pedido.dto';

@Controller('historial-estados-pedido')
@UseGuards(JwtAuthGuard)
export class HistorialEstadoPedidoController {
  constructor(private readonly service: HistorialEstadoPedidoService) {}

  @Get('pedido/:pedidoId')
  listarPorPedido(
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.listarPorPedido(Number(pedidoId), user.id);
  }

  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.obtenerPorId(Number(id), user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateHistorialEstadoPedidoDto,
  ) {
    return this.service.crear(user.id, dto);
  }
}
