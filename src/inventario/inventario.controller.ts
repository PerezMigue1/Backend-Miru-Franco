import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { ListMovimientosDto } from './dto/list-movimientos.dto';
import { InventarioService } from './inventario.service';

@Controller('inventario')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get('movimientos')
  listarMovimientos(@Query() filtros: ListMovimientosDto) {
    return this.inventarioService.listarMovimientos(filtros);
  }
}
