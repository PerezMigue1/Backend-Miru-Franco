import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { ClientesService } from './clientes.service';
import { ListClientesDto } from './dto/list-clientes.dto';
import { SegmentacionClientesService } from './segmentacion-clientes.service';

@Controller('clientes')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos('clientes:lectura')
export class ClientesController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly segmentacionService: SegmentacionClientesService,
  ) {}

  @Get()
  listar(@Query() query: ListClientesDto) {
    return this.clientesService.listar(query);
  }

  @Get('segmentacion')
  async segmentacion(@Query('incluirInactivos') incluirInactivos?: string) {
    const resultado = await this.segmentacionService.segmentarTodos(
      incluirInactivos === 'true',
    );
    return {
      success: true,
      count: resultado.data.length,
      ...resultado,
    };
  }

  @Get(':id/segmentacion')
  async segmentacionCliente(@Param('id') id: string) {
    return {
      success: true,
      data: await this.segmentacionService.segmentarCliente(id),
    };
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.clientesService.obtener(id);
  }

  @Get(':id/historial-compras')
  historialCompras(@Param('id') id: string) {
    return this.clientesService.historialCompras(id);
  }

  @Get(':id/historial-citas')
  historialCitas(@Param('id') id: string) {
    return this.clientesService.historialCitas(id);
  }
}
