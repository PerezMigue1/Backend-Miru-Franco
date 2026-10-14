import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { ProveedoresService } from './proveedores.service';
import { CreateProveedorDto } from './dto/create-proveedor.dto';
import { UpdateProveedorDto } from './dto/update-proveedor.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

@Controller('proveedores')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class ProveedoresController {
  constructor(private readonly proveedoresService: ProveedoresService) {}

  @Get()
  @Permisos('servicios:lectura')
  async listar() {
    return this.proveedoresService.listar();
  }

  @Get(':id')
  @Permisos('servicios:lectura')
  async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
    return this.proveedoresService.obtenerPorId(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permisos('servicios:escritura')
  async crear(@Body() dto: CreateProveedorDto) {
    return this.proveedoresService.crear(dto);
  }

  @Put(':id')
  @Permisos('servicios:escritura')
  async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProveedorDto) {
    return this.proveedoresService.actualizar(id, dto);
  }

  @Delete(':id')
  @Permisos('servicios:escritura')
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.proveedoresService.eliminar(id);
  }
}
