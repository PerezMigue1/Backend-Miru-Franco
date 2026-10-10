import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { EmpleadosService } from './empleados.service';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';

@Controller('empleados')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class EmpleadosController {
  constructor(private readonly empleadosService: EmpleadosService) {}

  @Get()
  @Permisos('empleados:lectura')
  listar() {
    return this.empleadosService.listar();
  }

  @Get(':usuarioId')
  @Permisos('empleados:lectura')
  obtenerPorUsuario(@Param('usuarioId') usuarioId: string) {
    return this.empleadosService.obtenerPorUsuario(usuarioId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  crear(@Body() dto: CreateEmpleadoDto) {
    return this.empleadosService.crear(dto);
  }

  /** Actualización parcial: solo se escriben los campos que vienen en el cuerpo. La web usa PATCH. */
  @Patch(':usuarioId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  actualizar(@Param('usuarioId') usuarioId: string, @Body() dto: UpdateEmpleadoDto) {
    return this.empleadosService.actualizar(usuarioId, dto);
  }

  /** Alias de PATCH para clientes anteriores: mismo DTO, mismos guards y misma actualización parcial. */
  @Put(':usuarioId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  actualizarPut(@Param('usuarioId') usuarioId: string, @Body() dto: UpdateEmpleadoDto) {
    return this.empleadosService.actualizar(usuarioId, dto);
  }

  @Delete(':usuarioId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  eliminar(@Param('usuarioId') usuarioId: string) {
    return this.empleadosService.eliminar(usuarioId);
  }
}
