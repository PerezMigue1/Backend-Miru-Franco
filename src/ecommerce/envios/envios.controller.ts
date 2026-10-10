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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { esPropios } from '../../common/utils/alcance-propio.util';
import { EnviosService } from './envios.service';
import { CreateEnvioDto } from './dto/create-envio.dto';
import { UpdateEnvioDto } from './dto/update-envio.dto';

// Ya no hay envío a domicilio: los envíos quedan como historial de pedidos anteriores.
// La clienta solo puede leer los de sus pedidos; crear, editar o borrar es solo de admin.
@Controller('envios')
@UseGuards(JwtAuthGuard)
export class EnviosController {
  constructor(private readonly service: EnviosService) {}

  @Get('pedido/:pedidoId')
  listarPorPedido(
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.listarPorPedido(Number(pedidoId), user.id, esPropios(propios));
  }

  @Get(':id')
  obtener(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.obtenerPorId(Number(id), user.id, esPropios(propios));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  crear(@CurrentUser() user: { id: string }, @Body() dto: CreateEnvioDto) {
    return this.service.crear(user.id, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  actualizar(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateEnvioDto,
  ) {
    return this.service.actualizar(Number(id), user.id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  eliminar(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(Number(id), user.id);
  }
}
