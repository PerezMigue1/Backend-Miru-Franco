import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientesService } from './clientes.service';
import { ListClientesDto } from './dto/list-clientes.dto';
import { CrearObservacionDto } from './dto/crear-observacion.dto';
import { ObservacionesClienteService } from './observaciones-cliente.service';
import { SegmentacionClientesService } from './segmentacion-clientes.service';

@Controller('clientes')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos('clientes:lectura')
export class ClientesController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly segmentacionService: SegmentacionClientesService,
    private readonly observacionesService: ObservacionesClienteService,
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

  /** Observaciones del CRM, de la más reciente a la más antigua, con autor y fecha. */
  @Get(':id/observaciones')
  listarObservaciones(@Param('id') id: string, @CurrentUser() user: { id: string; rol: string | null }) {
    return this.observacionesService.listar(id, { id: user.id, rol: user.rol });
  }

  @Post(':id/observaciones')
  @Permisos('clientes:escritura')
  crearObservacion(
    @Param('id') id: string,
    @Body() dto: CrearObservacionDto,
    @CurrentUser() user: { id: string; rol: string | null },
  ) {
    return this.observacionesService.crear(id, dto.texto, { id: user.id, rol: user.rol });
  }
}
