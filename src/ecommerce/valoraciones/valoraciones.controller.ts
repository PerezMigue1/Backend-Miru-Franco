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
import { ValoracionesService } from './valoraciones.service';
import { CreateValoracionDto } from './dto/create-valoracion.dto';
import { UpdateValoracionDto } from './dto/update-valoracion.dto';

@Controller('valoraciones')
export class ValoracionesController {
  constructor(private readonly service: ValoracionesService) {}

  /** Mis valoraciones (JWT). Admin: todas o `?usuarioId=`. */
  @Get()
  @UseGuards(JwtAuthGuard)
  listar(
    @CurrentUser() user: { id: string },
    @Query('usuarioId') usuarioId?: string,
  ) {
    return this.service.listar(user.id, usuarioId);
  }

  @Get('producto/:productoId')
  listarPorProducto(@Param('productoId', ParseIntPipe) productoId: number) {
    return this.service.listarPorProducto(productoId);
  }

  @Get('pedido/:pedidoId')
  @UseGuards(JwtAuthGuard)
  listarPorPedido(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.listarPorPedido(pedidoId, user.id, esPropios(propios));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  obtener(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }) {
    return this.service.obtenerPorId(id, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  crear(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateValoracionDto,
  ) {
    return this.service.crear(user.id, dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateValoracionDto,
  ) {
    return this.service.actualizar(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  eliminar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(id, user.id);
  }
}
