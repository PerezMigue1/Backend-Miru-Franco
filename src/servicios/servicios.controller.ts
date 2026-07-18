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
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

@Controller('servicios')
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Get()
  async listar(@Query('categoria') categoria?: string) {
    return this.serviciosService.listar(categoria);
  }

  /**
   * Listado para el panel admin: puede incluir servicios inactivos con ?incluirInactivos=true.
   * Debe declararse ANTES de @Get(':id') para que Nest no lo capture como :id.
   */
  @Get('admin')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:lectura')
  async listarAdmin(
    @Query('categoria') categoria?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
  ) {
    return this.serviciosService.listar(categoria, incluirInactivos === 'true');
  }

  @Get(':id')
  async obtenerPorId(@Param('id') id: string) {
    return this.serviciosService.obtenerPorId(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async crear(@Body() dto: CreateServicioDto) {
    return this.serviciosService.crear(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async actualizar(@Param('id') id: string, @Body() dto: UpdateServicioDto) {
    return this.serviciosService.actualizar(Number(id), dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async eliminar(@Param('id') id: string) {
    return this.serviciosService.eliminar(Number(id));
  }
}
