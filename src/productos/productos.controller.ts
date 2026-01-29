import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProductosService } from './productos.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';

@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  /**
   * Obtener catálogo de productos (público)
   * Filtro opcional por categoría: GET /productos?categoria=shampoo
   */
  @Get()
  async listar(@Query('categoria') categoria?: string) {
    return this.productosService.listar(categoria);
  }

  /**
   * Obtener producto por ID (público)
   */
  @Get(':id')
  async obtenerPorId(@Param('id') id: string) {
    return this.productosService.obtenerPorId(Number(id));
  }

  /**
   * Crear nuevo producto
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async crear(@Body() dto: CreateProductoDto) {
    return this.productosService.crear(dto);
  }

  /**
   * Actualizar producto por ID
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async actualizar(@Param('id') id: string, @Body() dto: UpdateProductoDto) {
    return this.productosService.actualizar(Number(id), dto);
  }

  /**
   * Eliminar producto por ID (borrado lógico - deshabilita)
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async eliminar(@Param('id') id: string) {
    return this.productosService.eliminar(Number(id));
  }
}

