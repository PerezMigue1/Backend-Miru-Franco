import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PedidoItemsService } from './pedido-items.service';
import { CreatePedidoItemDto } from './dto/create-pedido-item.dto';
import { CreatePedidoItemBodyDto } from './dto/create-pedido-item-body.dto';
import { UpdatePedidoItemDto } from './dto/update-pedido-item.dto';

@Controller('pedidos/:pedidoId/items')
@UseGuards(JwtAuthGuard)
export class PedidoItemsController {
  constructor(private readonly service: PedidoItemsService) {}

  @Get()
  listar(
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.listarPorPedido(Number(pedidoId), user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreatePedidoItemBodyDto,
  ) {
    const dto: CreatePedidoItemDto = {
      ...body,
      pedidoId: Number(pedidoId),
    };
    return this.service.crear(user.id, dto);
  }

  @Put(':itemId')
  actualizar(
    @Param('pedidoId') pedidoId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdatePedidoItemDto,
  ) {
    void pedidoId;
    return this.service.actualizar(Number(itemId), user.id, dto);
  }

  @Delete(':itemId')
  eliminar(
    @Param('pedidoId') pedidoId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string },
  ) {
    void pedidoId;
    return this.service.eliminar(Number(itemId), user.id);
  }
}
