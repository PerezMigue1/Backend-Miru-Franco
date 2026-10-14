import { Body, Controller, Get, Param, Post, Request, UseGuards, HttpCode, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { ComprasService } from './compras.service';
import { CreateCompraDto } from './dto/create-compra.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

@Controller('compras')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Get()
  @Permisos('inventario:lectura')
  async listar() {
    return this.comprasService.listar();
  }

  @Get(':id')
  @Permisos('inventario:lectura')
  async obtenerPorId(@Param('id', ParseIntPipe) id: number) {
    return this.comprasService.obtenerPorId(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permisos('inventario:escritura')
  async crear(@Body() dto: CreateCompraDto, @Request() req: any) {
    return this.comprasService.crear(dto, req.user.id);
  }
}
