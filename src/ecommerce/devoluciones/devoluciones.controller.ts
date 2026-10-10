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
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../../common/guards/permisos.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { esPropios } from '../../common/utils/alcance-propio.util';
import { DevolucionesService, PERMISO_GESTIONAR_DEVOLUCIONES } from './devoluciones.service';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { AprobarDevolucionDto, RechazarDevolucionDto } from './dto/resolver-devolucion.dto';

@Controller('devoluciones')
@UseGuards(JwtAuthGuard)
export class DevolucionesController {
  constructor(private readonly service: DevolucionesService) {}

  /** Con `propios=true`, las solicitudes de quien consulta; sin él, todas (requiere devoluciones:gestionar). */
  @Get()
  listar(
    @CurrentUser() user: { id: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('estado') estado?: string,
    @Query('propios') propios?: string,
  ) {
    const parsedPage = page === undefined || page === '' ? 1 : Number.parseInt(page, 10);
    const parsedLimit = limit === undefined || limit === '' ? 20 : Number.parseInt(limit, 10);
    if (Number.isNaN(parsedPage) || Number.isNaN(parsedLimit) || parsedPage < 1 || parsedLimit < 1) {
      throw new BadRequestException('page y limit deben ser enteros positivos');
    }
    return this.service.listar(user.id, {
      page: parsedPage,
      limit: Math.min(parsedLimit, 100),
      estado: estado || undefined,
      propios: esPropios(propios),
    });
  }

  @Get('pedido/:pedidoId')
  listarPorPedido(
    @Param('pedidoId', ParseIntPipe) pedidoId: number,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.listarPorPedido(pedidoId, user.id, esPropios(propios));
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }, @Query('propios') propios?: string) {
    return this.service.obtenerPorId(id, user.id, esPropios(propios));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@CurrentUser() user: { id: string }, @Body() dto: CreateDevolucionDto, @Query('propios') propios?: string) {
    return this.service.crear(user.id, dto, esPropios(propios));
  }

  /** La dueña retira su solicitud mientras siga pendiente. */
  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }) {
    return this.service.cancelar(id, user.id);
  }

  @Post(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermisosGuard)
  @Permisos(PERMISO_GESTIONAR_DEVOLUCIONES)
  aprobar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }, @Body() dto: AprobarDevolucionDto) {
    return this.service.aprobar(id, user.id, dto);
  }

  @Post(':id/rechazar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermisosGuard)
  @Permisos(PERMISO_GESTIONAR_DEVOLUCIONES)
  rechazar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }, @Body() dto: RechazarDevolucionDto) {
    return this.service.rechazar(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.service.eliminar(id);
  }
}
