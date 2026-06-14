import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { EmpleadosService } from './empleados.service';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';

@Controller('empleados')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class EmpleadosController {
  constructor(private readonly empleadosService: EmpleadosService) {}

  @Get()
  listar() {
    return this.empleadosService.listar();
  }

  @Get(':usuarioId')
  obtenerPorUsuario(@Param('usuarioId') usuarioId: string) {
    return this.empleadosService.obtenerPorUsuario(usuarioId);
  }

  @Post()
  crear(@Body() dto: CreateEmpleadoDto) {
    return this.empleadosService.crear(dto);
  }

  @Put(':usuarioId')
  actualizar(@Param('usuarioId') usuarioId: string, @Body() dto: UpdateEmpleadoDto) {
    return this.empleadosService.actualizar(usuarioId, dto);
  }

  @Delete(':usuarioId')
  eliminar(@Param('usuarioId') usuarioId: string) {
    return this.empleadosService.eliminar(usuarioId);
  }
}
