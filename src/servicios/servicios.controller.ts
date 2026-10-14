import {
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
import { ServiciosService } from './servicios.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { ActualizarAnticipoServicioDto } from './dto/actualizar-anticipo.dto';

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

  /**
   * Público. Con sesión opcional: el panel de edición del admin usa esta misma ruta y el personal con
   * servicios:lectura ve también los inactivos; visitantes y clientas solo los activos.
   */
  @Get(':id')
  @UseGuards(SesionOpcionalGuard)
  async obtenerPorId(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.serviciosService.obtenerPorId(id, req.user?.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async crear(@Body() dto: CreateServicioDto) {
    return this.serviciosService.crear(dto);
  }

  /** PUT /api/servicios/:id/anticipo: anticipo que pide el servicio al agendar en línea (estilista y admin). */
  @Put(':id/anticipo')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async actualizarAnticipo(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarAnticipoServicioDto) {
    return this.serviciosService.actualizarAnticipo(id, dto.anticipoMonto ?? null);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateServicioDto) {
    return this.serviciosService.actualizar(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermisosGuard)
  @Permisos('servicios:escritura')
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.serviciosService.eliminar(id);
  }
}
