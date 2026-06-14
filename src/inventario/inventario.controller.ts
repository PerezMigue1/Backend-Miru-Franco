import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { ListMovimientosDto } from './dto/list-movimientos.dto';
import { InventarioService } from './inventario.service';
import { AlertasStockDto } from './dto/alertas-stock.dto';
import { CaducidadesDto } from './dto/caducidades.dto';
import { ConteoFisicoDto } from './dto/conteo-fisico.dto';
import { CreateAjusteDto } from './dto/create-ajuste.dto';
import { CreateEntradaDto } from './dto/create-entrada.dto';
import { CreateSalidaDto } from './dto/create-salida.dto';

@Controller('inventario')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get('movimientos')
  listarMovimientos(@Query() filtros: ListMovimientosDto) {
    return this.inventarioService.listarMovimientos(filtros);
  }

  @Post('entradas')
  registrarEntrada(@Body() dto: CreateEntradaDto, @Req() req: any) {
    return this.inventarioService.registrarEntrada(dto, req.user?.id);
  }

  @Post('salidas')
  registrarSalida(@Body() dto: CreateSalidaDto, @Req() req: any) {
    return this.inventarioService.registrarSalida(dto, req.user?.id);
  }

  @Post('ajustes')
  registrarAjuste(@Body() dto: CreateAjusteDto, @Req() req: any) {
    return this.inventarioService.registrarAjuste(dto, req.user?.id);
  }

  @Post('conteo-fisico')
  conteoFisico(@Body() dto: ConteoFisicoDto, @Req() req: any) {
    return this.inventarioService.conteoFisico(dto, req.user?.id);
  }

  @Get('alertas-stock')
  alertasStock(@Query() query: AlertasStockDto) {
    return this.inventarioService.alertasStock(query);
  }

  @Get('caducidades')
  caducidades(@Query() query: CaducidadesDto) {
    return this.inventarioService.caducidades(query);
  }

  @Get('kardex/:presentacionId')
  kardex(@Param('presentacionId', ParseIntPipe) presentacionId: number) {
    return this.inventarioService.kardex(presentacionId);
  }
}
