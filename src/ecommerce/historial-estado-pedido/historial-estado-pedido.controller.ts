import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { esPropios } from '../../common/utils/alcance-propio.util';
import { HistorialEstadoPedidoService } from './historial-estado-pedido.service';
import { CreateHistorialEstadoPedidoDto } from './dto/create-historial-estado-pedido.dto';

@Controller('historial-estados-pedido')
@UseGuards(JwtAuthGuard)
export class HistorialEstadoPedidoController {
  constructor(private readonly service: HistorialEstadoPedidoService) {}

  @Get('pedido/:pedidoId')
  listarPorPedido(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.listarPorPedido(pedidoId, user.id, esPropios(propios));
  }

  @Get(':id')
  obtener(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.obtenerPorId(id, user.id, esPropios(propios));
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
