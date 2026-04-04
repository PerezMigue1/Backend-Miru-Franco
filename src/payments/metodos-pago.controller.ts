import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MetodosPagoService } from './metodos-pago.service';
import { CreateMetodoPagoDto } from './dto/create-metodo-pago.dto';
import { UpdateMetodoPagoDto } from './dto/update-metodo-pago.dto';

/**
 * Tarjetas / métodos tokenizados guardados (perfil + checkout).
 * Base: GET/POST /api/payments/metodos-pago
 */
@Controller('payments/metodos-pago')
@UseGuards(JwtAuthGuard)
export class MetodosPagoController {
  constructor(private readonly service: MetodosPagoService) {}

  @Get()
  listar(
    @CurrentUser() user: { id: string },
    @Query('usuarioId') usuarioId?: string,
  ) {
    return this.service.listar(user.id, usuarioId);
  }

  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.obtenerPorId(id, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateMetodoPagoDto,
  ) {
    return this.service.crear(user.id, dto);
  }

  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateMetodoPagoDto,
  ) {
    return this.service.actualizar(id, user.id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(id, user.id);
  }
}
