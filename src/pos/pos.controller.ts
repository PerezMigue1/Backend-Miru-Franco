import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { PosService } from './pos.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { CancelarVentaDto } from './dto/cancelar-venta.dto';
import { ListVentasDto } from './dto/list-ventas.dto';
import { CreateCorteDto } from './dto/create-corte.dto';
import { ListCortesDto } from './dto/list-cortes.dto';

@Controller('api/pos')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos('ventas:escritura')
export class PosController {
  constructor(private readonly posService: PosService) {}

  /** GET /api/pos/ventas */
  @Get('ventas')
  listarVentas(@Query() query: ListVentasDto) {
    return this.posService.listarVentas(query);
  }

  /** GET /api/pos/ventas/:id */
  @Get('ventas/:id')
  obtenerVenta(@Param('id', ParseIntPipe) id: number) {
    return this.posService.obtenerVenta(id);
  }

  /** POST /api/pos/ventas */
  @Post('ventas')
  crearVenta(@Body() dto: CreateVentaDto, @Request() req: any) {
    return this.posService.crearVenta(dto, req.user.id);
  }

  /** PATCH /api/pos/ventas/:id/cancelar */
  @Patch('ventas/:id/cancelar')
  cancelarVenta(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelarVentaDto,
    @Request() req: any,
  ) {
    return this.posService.cancelarVenta(id, dto, req.user.id);
  }

  /** GET /api/pos/resumen?desde=&hasta= */
  @Get('resumen')
  resumen(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.posService.resumen(desde, hasta);
  }

  /** GET /api/pos/cortes */
  @Get('cortes')
  listarCortes(@Query() query: ListCortesDto) {
    return this.posService.listarCortes(query);
  }

  /** GET /api/pos/cortes/:id */
  @Get('cortes/:id')
  obtenerCorte(@Param('id', ParseIntPipe) id: number) {
    return this.posService.obtenerCorte(id);
  }

  /** POST /api/pos/cortes */
  @Post('cortes')
  crearCorte(@Body() dto: CreateCorteDto, @Request() req: any) {
    return this.posService.crearCorte(dto, req.user.id);
  }
}
