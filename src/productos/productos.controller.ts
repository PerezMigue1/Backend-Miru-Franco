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
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProductosService } from './productos.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';

/** Un id que no es número responde 400 (antes llegaba NaN a Prisma y daba 500). */
const idPipe = new ParseIntPipe({ exceptionFactory: () => new BadRequestException('Id inválido') });

@Controller('productos')
export class ProductosController {
  constructor(private readonly productosService: ProductosService) {}

  /**
   * Obtener catálogo de productos (público): solo activos. Filtro opcional: ?categoria=shampoo
   * Con sesión opcional: ?incluirInactivos=1 suma los inactivos solo para admin o servicios:escritura
   * (inventario admin); para el resto se ignora.
   */
  @Get()
  @UseGuards(SesionOpcionalGuard)
  async listar(
    @Request() req: any,
    @Query('categoria') categoria?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
  ) {
    const pideInactivos = incluirInactivos === '1' || incluirInactivos === 'true';
    return this.productosService.listar(categoria, pideInactivos, req.user?.id);
  }

  /**
   * Obtener producto por ID (público). Uno inactivo responde 404, salvo al admin o a quien tiene
   * servicios:escritura (detalle admin, para reactivarlo).
   */
  @Get(':id')
  @UseGuards(SesionOpcionalGuard)
  async obtenerPorId(@Param('id', idPipe) id: number, @Request() req: any) {
    return this.productosService.obtenerPorId(id, req.user?.id);
  }

  /**
   * Crear nuevo producto
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async crear(@Body() dto: CreateProductoDto, @CurrentUser() usuario: { id: string }) {
    return this.productosService.crear(dto, usuario?.id);
  }

  /**
   * Actualizar producto por ID
   * ✅ Solo para administradores (rol = 'admin')
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async actualizar(@Param('id', idPipe) id: number, @Body() dto: UpdateProductoDto, @CurrentUser() usuario: { id: string }) {
    return this.productosService.actualizar(id, dto, usuario?.id);
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

