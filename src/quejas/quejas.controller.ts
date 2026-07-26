import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { QuejasService } from './quejas.service';
import { CreateQuejaDto } from './dto/create-queja.dto';
import { UpdateQuejaDto } from './dto/update-queja.dto';
import { ListQuejasDto } from './dto/list-quejas.dto';

@Controller('quejas')
export class QuejasController {
  constructor(private readonly quejasService: QuejasService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listar(@Query() query: ListQuejasDto) {
    return this.quejasService.listar(query);
  }

  /**
   * Admin o staff con `clientes:lectura` (mismo permiso que ya abre el resto de
   * la ficha de cliente en /clientes/:id). El chequeo vive en el service para
   * seguir el mismo patrón usado en pedidos/pagos: sin gate nuevo aquí.
   */
  @Get('cliente/:clienteId')
  @UseGuards(JwtAuthGuard)
  listarPorCliente(@Param('clienteId') clienteId: string, @Req() req: any) {
    return this.quejasService.listarPorCliente(clienteId, req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.quejasService.obtener(id);
  }

  /** Cualquier usuario autenticado puede registrar una queja. */
  @Post()
  @UseGuards(JwtAuthGuard)
  crear(@Body() dto: CreateQuejaDto, @Req() req: any) {
    return this.quejasService.crear(dto, req.user.id, req.user.rol ?? '');
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuejaDto, @Req() req: any) {
    return this.quejasService.actualizar(id, dto, req.user.rol ?? '');
  }
}
