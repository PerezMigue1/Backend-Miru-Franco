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
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { SeguimientosService } from './seguimientos.service';
import { CreateSeguimientoDto } from './dto/create-seguimiento.dto';
import { UpdateSeguimientoDto } from './dto/update-seguimiento.dto';
import { ListSeguimientosDto } from './dto/list-seguimientos.dto';

@Controller('seguimientos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'estilista', 'empleado', 'becario', 'becado')
export class SeguimientosController {
  constructor(private readonly seguimientosService: SeguimientosService) {}

  @Get()
  listar(@Query() query: ListSeguimientosDto) {
    return this.seguimientosService.listar(query);
  }

  @Get('cliente/:clienteId')
  listarPorCliente(@Param('clienteId') clienteId: string) {
    return this.seguimientosService.listarPorCliente(clienteId);
  }

  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.seguimientosService.obtener(id);
  }

  @Post()
  crear(@Body() dto: CreateSeguimientoDto) {
    return this.seguimientosService.crear(dto);
  }

  @Put(':id')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSeguimientoDto) {
    return this.seguimientosService.actualizar(id, dto);
  }
}
