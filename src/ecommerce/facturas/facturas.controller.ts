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
import { PermisosGuard, Permisos } from '../../common/guards/permisos.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { esPropios } from '../../common/utils/alcance-propio.util';
import { FacturasService } from './facturas.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';

@Controller('facturas')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class FacturasController {
  constructor(private readonly service: FacturasService) {}

  /**
   * GET /api/facturas — todas las facturas/notas (con o sin pedido), para el panel admin.
   * Restringido a caja:lectura (admin/estilista): expone montos, RFC y razón social de
   * todos los clientes. El cliente ve las suyas por GET /api/facturas/pedido/:id, que no pasa por aquí.
   */
  @Get()
  @Permisos('caja:lectura')
  listarTodas() {
    return this.service.listarTodas();
  }

  @Get('pedido/:pedidoId')
  listarPorPedido(
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: { id: string },
    @Query('propios') propios?: string,
  ) {
    return this.service.listarPorPedido(Number(pedidoId), user.id, esPropios(propios));
  }

  /** La dueña del pedido ve su factura; la nota sin pedido o la factura ajena, solo caja (lectura). */
  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.obtenerPorId(Number(id), user.id);
  }

  /** Caja registra cualquier documento; la clienta solo solicita un CFDI de un pedido suyo (nace 'solicitada'). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@CurrentUser() user: { id: string }, @Body() dto: CreateFacturaDto) {
    return this.service.crear(user.id, dto);
  }

  /** Datos fiscales, estado y monto: solo caja. La clienta no cambia ni borra facturas, ni las de sus pedidos. */
  @Put(':id')
  @Permisos('caja:escritura')
  actualizar(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateFacturaDto,
  ) {
    return this.service.actualizar(Number(id), user.id, dto);
  }

  @Delete(':id')
  @Permisos('caja:escritura')
  eliminar(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(Number(id), user.id);
  }
}
