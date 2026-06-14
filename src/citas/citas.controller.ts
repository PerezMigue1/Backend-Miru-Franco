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
import { CitasService } from './citas.service';
import { CreateCitaDto } from './dto/create-cita.dto';
import { UpdateCitaDto } from './dto/update-cita.dto';
import { ListCitasDto } from './dto/list-citas.dto';
import { ReprogramarCitaDto } from './dto/reprogramar-cita.dto';
import { CancelarCitaDto } from './dto/cancelar-cita.dto';
import { MaterialesCitaDto } from './dto/materiales-cita.dto';

@Controller('api/citas')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class CitasController {
  constructor(private readonly citasService: CitasService) {}

  /** GET /api/citas — listado paginado con filtros */
  @Get()
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  listar(@Query() query: ListCitasDto, @Request() req: any) {
    return this.citasService.listar(query, req.user.id, req.rolUsuario);
  }

  /** GET /api/citas/dia?fecha=YYYY-MM-DD — citas del día */
  @Get('dia')
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  listarDia(@Query('fecha') fecha: string, @Request() req: any) {
    return this.citasService.listarDia(fecha, req.user.id, req.rolUsuario);
  }

  /** GET /api/citas/calendario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
  @Get('calendario')
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  listarCalendario(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Request() req: any,
  ) {
    return this.citasService.listarCalendario(desde, hasta, req.user.id, req.rolUsuario);
  }

  /** GET /api/citas/:id */
  @Get(':id')
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  obtener(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.citasService.obtener(id, req.user.id, req.rolUsuario);
  }

  /** POST /api/citas */
  @Post()
  @Permisos('citas:escritura', 'citas:propia')
  crear(@Body() dto: CreateCitaDto, @Request() req: any) {
    return this.citasService.crear(dto, req.user.id, req.rolUsuario);
  }

  /** PATCH /api/citas/:id — admin only (estado, reasignación, etc.) */
  @Patch(':id')
  @Permisos('citas:escritura')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCitaDto) {
    return this.citasService.actualizar(id, dto);
  }

  /** PATCH /api/citas/:id/check-in */
  @Patch(':id/check-in')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  checkIn(@Param('id', ParseIntPipe) id: number) {
    return this.citasService.checkIn(id);
  }

  /** PATCH /api/citas/:id/check-out */
  @Patch(':id/check-out')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  checkOut(@Param('id', ParseIntPipe) id: number) {
    return this.citasService.checkOut(id);
  }

  /** PATCH /api/citas/:id/reprogramar */
  @Patch(':id/reprogramar')
  @Permisos('citas:escritura', 'citas:propias', 'citas:propia')
  reprogramar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReprogramarCitaDto,
  ) {
    return this.citasService.reprogramar(id, dto);
  }

  /** PATCH /api/citas/:id/cancelar */
  @Patch(':id/cancelar')
  @Permisos('citas:escritura', 'citas:propias', 'citas:propia')
  cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelarCitaDto,
  ) {
    return this.citasService.cancelar(id, dto);
  }

  /** POST /api/citas/:id/materiales */
  @Post(':id/materiales')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  registrarMateriales(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MaterialesCitaDto,
    @Request() req: any,
  ) {
    return this.citasService.registrarMateriales(id, dto, req.user.id);
  }
}
