import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { ClientesService } from './clientes.service';
import { ListClientesDto } from './dto/list-clientes.dto';

@Controller('clientes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  @Roles('admin', 'estilista', 'empleado', 'becario', 'becado')
  listar(@Query() query: ListClientesDto) {
    return this.clientesService.listar(query);
  }

  @Get(':id')
  @Roles('admin', 'estilista', 'empleado', 'becario', 'becado')
  obtener(@Param('id') id: string) {
    return this.clientesService.obtener(id);
  }

  @Get(':id/historial-compras')
  @Roles('admin', 'estilista', 'empleado', 'becario', 'becado')
  historialCompras(@Param('id') id: string) {
    return this.clientesService.historialCompras(id);
  }

  @Get(':id/historial-citas')
  @Roles('admin', 'estilista', 'empleado', 'becario', 'becado')
  historialCitas(@Param('id') id: string) {
    return this.clientesService.historialCitas(id);
  }
}
