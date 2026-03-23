import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DireccionesUsuarioService } from './direcciones-usuario.service';
import { CreateDireccionUsuarioDto } from './dto/create-direccion-usuario.dto';
import { UpdateDireccionUsuarioDto } from './dto/update-direccion-usuario.dto';

@Controller('direcciones-usuario')
@UseGuards(JwtAuthGuard)
export class DireccionesUsuarioController {
  constructor(private readonly service: DireccionesUsuarioService) {}

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
    @Body() dto: CreateDireccionUsuarioDto,
  ) {
    return this.service.crear(user.id, dto);
  }

  @Put(':id')
  actualizar(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateDireccionUsuarioDto,
  ) {
    return this.service.actualizar(id, user.id, dto);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.eliminar(id, user.id);
  }
}
