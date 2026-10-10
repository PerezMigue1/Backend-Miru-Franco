import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../../common/guards/permisos.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { esPropios } from '../../common/utils/alcance-propio.util';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { PagosService } from './pagos.service';
import { CreatePagoDto } from './dto/create-pago.dto';
import { UpdatePagoDto } from './dto/update-pago.dto';

@Controller('pagos')
@UseGuards(JwtAuthGuard)
export class PagosController {
  constructor(
    private readonly service: PagosService,
    private readonly access: EcommerceAccessService,
  ) {}

  /** GET — el dueño del pedido (o admin) puede seguir viendo el estado de su pago. Sin @Permisos. */
  /** Con `?propios=true` (portal de clienta) el pedido ajeno responde 404 para cualquier rol. */
  @Get('pedido/:pedidoId')
  async listarPorPedido(
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    if (esPropios(propios)) {
      await this.access.assertPedido(user.id, Number(pedidoId), true);
    }
    return this.service.listarPorPedido(Number(pedidoId), user.id);
  }

  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.obtenerPorId(Number(id), user.id);
  }

  /**
   * Sin pasarela real: registrar/confirmar un pago es cobro físico en el salón,
   * lo hace quien maneja caja (la estilista dueña), no el cliente ni el técnico admin.
   * Oculto hasta integrar pasarela (Mercado Pago). No borrar.
   */
  @Post()
  @UseGuards(PermisosGuard)
  @Permisos('caja:escritura')
  crear(@Request() req: any, @Body() dto: CreatePagoDto) {
    return this.service.crear(req.user.id, dto, req.rolUsuario, req.permisosUsuario);
  }

  /** Ver nota de `crear()` — mismo motivo. Oculto hasta integrar pasarela (Mercado Pago). No borrar. */
  @Patch(':id')
  @UseGuards(PermisosGuard)
  @Permisos('caja:escritura')
  actualizar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdatePagoDto,
  ) {
    return this.service.actualizar(Number(id), req.user.id, dto, req.rolUsuario, req.permisosUsuario);
  }
}
