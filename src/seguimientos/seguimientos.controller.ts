import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { SeguimientosService } from './seguimientos.service';
import { CreateSeguimientoDto } from './dto/create-seguimiento.dto';
import { UpdateSeguimientoDto } from './dto/update-seguimiento.dto';
import { ListSeguimientosDto } from './dto/list-seguimientos.dto';

@Controller('seguimientos')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class SeguimientosController {
  constructor(private readonly seguimientosService: SeguimientosService) {}

  @Get()
  @Permisos('seguimientos:lectura')
  listar(@Query() query: ListSeguimientosDto) {
    return this.seguimientosService.listar(query);
  }

  @Get('cliente/:clienteId')
  @Permisos('seguimientos:lectura')
  listarPorCliente(@Param('clienteId') clienteId: string) {
    return this.seguimientosService.listarPorCliente(clienteId);
  }

  @Get(':id')
  @Permisos('seguimientos:lectura')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.seguimientosService.obtener(id);
  }

  @Post()
  @Permisos('seguimientos:escritura')
  crear(@Body() dto: CreateSeguimientoDto) {
    return this.seguimientosService.crear(dto);
  }

  @Put(':id')
  @Permisos('seguimientos:escritura')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSeguimientoDto) {
    return this.seguimientosService.actualizar(id, dto);
  }
}
