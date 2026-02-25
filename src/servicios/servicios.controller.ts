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
import { ServiciosService } from './servicios.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';

@Controller('servicios')
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Get()
  async listar(@Query('categoria') categoria?: string) {
    return this.serviciosService.listar(categoria);
  }

  @Get(':id')
  async obtenerPorId(@Param('id') id: string) {
    return this.serviciosService.obtenerPorId(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async crear(@Body() dto: CreateServicioDto) {
    return this.serviciosService.crear(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async actualizar(@Param('id') id: string, @Body() dto: UpdateServicioDto) {
    return this.serviciosService.actualizar(Number(id), dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async eliminar(@Param('id') id: string) {
    return this.serviciosService.eliminar(Number(id));
  }
}
