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
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { esPropios } from '../../common/utils/alcance-propio.util';
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
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.listarPorPedido(pedidoId, user.id, esPropios(propios));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @CurrentUser() user: { id: string },
    @Body() body: CreatePedidoItemBodyDto,
  ) {
    const dto: CreatePedidoItemDto = {
      ...body,
      pedidoId,
    };
    return this.service.crear(user.id, dto);
  }

  @Put(':itemId')
  actualizar(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdatePedidoItemDto,
  ) {
    return this.service.actualizar(itemId, user.id, dto, pedidoId);
  }

  @Delete(':itemId')
  eliminar(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.eliminar(itemId, user.id, pedidoId);
  }
}
