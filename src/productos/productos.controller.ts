import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

/** Un id que no es número responde 400 (antes llegaba NaN a Prisma y daba 500). */
const idPipe = new ParseIntPipe({ exceptionFactory: () => new BadRequestException('Id inválido') });

@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  /**
   * Obtener catálogo de productos (público)
   * Devuelve todos los productos. Filtro opcional: ?categoria=shampoo
   */
  @Get()
  async listar(@Query('categoria') categoria?: string) {
    return this.productosService.listar(categoria);
  }

  /**
   * Obtener producto por ID (público)
   */
  @Get(':id')
  async obtenerPorId(@Param('id', idPipe) id: number) {
    return this.productosService.obtenerPorId(id);
  }

  /**
   * Crear nuevo producto
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async crear(@Body() dto: CreateProductoDto) {
    return this.productosService.crear(dto);
  }

  /**
   * Actualizar producto por ID
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async actualizar(@Param('id', idPipe) id: number, @Body() dto: UpdateProductoDto) {
    return this.productosService.actualizar(id, dto);
  }

  /**
   * Eliminar producto por ID (borrado lógico - deshabilita)
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async eliminar(@Param('id', idPipe) id: number) {
    return this.productosService.eliminar(id);
  }
}

