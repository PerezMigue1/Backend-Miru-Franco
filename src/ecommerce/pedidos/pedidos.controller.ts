import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { Permisos, PermisosGuard } from '../../common/guards/permisos.guard';
import { PERMISO_ENTREGAR_PEDIDOS } from '../common/permisos-pedido.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PedidosService } from './pedidos.service';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { UpdatePedidoDto } from './dto/update-pedido.dto';
import { EntregarPedidoDto } from './dto/entregar-pedido.dto';
import { esPropios } from '../../common/utils/alcance-propio.util';

@Controller('pedidos')
@UseGuards(JwtAuthGuard)
export class PedidosController {
  constructor(private readonly service: PedidosService) {}

  @Get()
  listar(
    @CurrentUser() user: { id: string },
    @Query('usuarioId') usuarioId?: string,
    @Query('estado') estado?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('metodoPago') metodoPago?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('propios') propios?: string,
  ) {
    const parsedPage =
      page === undefined || page === '' ? 1 : Number.parseInt(page, 10);
    const parsedLimit =
      limit === undefined || limit === '' ? 20 : Number.parseInt(limit, 10);
    if (
      Number.isNaN(parsedPage) ||
      Number.isNaN(parsedLimit) ||
      parsedPage < 1 ||
      parsedLimit < 1
    ) {
      throw new BadRequestException('page y limit deben ser enteros positivos');
    }

    return this.service.listar(user.id, {
      usuarioId,
      estado,
      fechaDesde,
      fechaHasta,
      metodoPago,
      q,
      sort,
      page: parsedPage,
      limit: Math.min(parsedLimit, 100),
      propios: esPropios(propios),
    });
  }

  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() user: { id: string }, @Query('propios') propios?: string) {
    return this.service.obtenerPorId(Number(id), user.id, esPropios(propios));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePedidoDto,
    @Query('propios') propios?: string,
  ) {
    return this.service.crear(user.id, dto, esPropios(propios));
  }

  @Put(':id')
  actualizar(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdatePedidoDto,
    @Query('propios') propios?: string,
  ) {
    return this.service.actualizar(Number(id), user.id, dto, esPropios(propios));
  }

  /** "Marcar listo para recoger" (Pedidos por recoger): permiso pedidos:entregar. */
  @Post(':id/listo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermisosGuard)
  @Permisos(PERMISO_ENTREGAR_PEDIDOS)
  marcarListo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }) {
    return this.service.marcarListo(id, user.id);
  }

  /** "Marcar entregado" o "Cobrar y entregar" (con metodoCobro): permiso pedidos:entregar. */
  @Post(':id/entregar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermisosGuard)
  @Permisos(PERMISO_ENTREGAR_PEDIDOS)
  entregar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: string },
    @Body() dto: EntregarPedidoDto,
  ) {
    return this.service.entregar(id, user.id, dto.metodoCobro);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  eliminar(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(Number(id), user.id);
  }
}
