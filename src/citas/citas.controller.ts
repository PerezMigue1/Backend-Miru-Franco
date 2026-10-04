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
import { DisponibilidadCitasDto } from './dto/disponibilidad-citas.dto';
import { PredecirRiesgoCitasDto } from './dto/predecir-riesgo-citas.dto';
import { CrearCitaSinCitaDto } from './dto/crear-cita-sin-cita.dto';
import { RiesgoCancelacionService } from './riesgo-cancelacion.service';
import { solicitanteDe } from '../common/utils/permisos-citas.util';

@Controller('citas')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class CitasController {
  constructor(
    private readonly citasService: CitasService,
    private readonly riesgoCancelacionService: RiesgoCancelacionService,
  ) {}

  /** GET /api/citas — listado paginado con filtros */
  @Get()
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  listar(@Query() query: ListCitasDto, @Request() req: any) {
    return this.citasService.listar(query, req.user.id, req.rolUsuario);
  }

  /** GET /api/citas/dia?fecha=YYYY-MM-DD&especialistaId=... — citas del día */
  @Get('dia')
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  listarDia(
    @Query('fecha') fecha: string,
    @Query('especialistaId') especialistaId: string,
    @Request() req: any,
  ) {
    return this.citasService.listarDia(fecha, req.user.id, req.rolUsuario, especialistaId);
  }

  /** GET /api/citas/calendario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&especialistaId=... */
  @Get('calendario')
  @Permisos('citas:propias', 'citas:asignadas', 'citas:escritura', 'citas:propia')
  listarCalendario(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('especialistaId') especialistaId: string,
    @Request() req: any,
  ) {
    return this.citasService.listarCalendario(desde, hasta, req.user.id, req.rolUsuario, especialistaId);
  }

  /**
   * GET /api/citas/especialistas — para que el cliente elija a quién agendar.
   * Sin @Permisos: cualquier autenticado (el cliente no tiene clave de citas de staff).
   * Debe ir antes de `:id` para que Nest no intente parsear "especialistas" como id numérico.
   */
  @Get('especialistas')
  listarEspecialistas() {
    return this.citasService.listarEspecialistas();
  }

  /**
   * GET /api/citas/disponibilidad?especialistaId=&fecha=YYYY-MM-DD&servicioId=
   * Slots libres de ese especialista ese día, para la duración real del servicio.
   * Sin @Permisos, mismo motivo que especialistas. Debe ir antes de `:id`.
   */
  @Get('disponibilidad')
  disponibilidad(@Query() query: DisponibilidadCitasDto) {
    return this.citasService.disponibilidad(query);
  }

  /**
   * GET /api/citas/especialistas-libres?servicioId= — personal que puede hacer el servicio y está libre ahora
   * (para registrar un turno sin cita). Debe ir antes de `:id`.
   */
  @Get('especialistas-libres')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  especialistasLibres(@Query('servicioId', ParseIntPipe) servicioId: number) {
    return this.citasService.especialistasLibres(servicioId);
  }

  /** GET /api/citas/personal — personal activo que atiende, para elegir participantes. Antes de `:id`. */
  @Get('personal')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias', 'ventas:escritura')
  personal() {
    return this.citasService.personal();
  }

  /** GET /api/citas/por-cobrar — citas finalizadas sin venta, para el punto de venta. Antes de `:id`. */
  @Get('por-cobrar')
  @Permisos('ventas:escritura')
  porCobrar() {
    return this.citasService.porCobrar();
  }

  /** POST /api/citas/sin-cita — turno inmediato de alguien que llega sin cita (recepción). */
  @Post('sin-cita')
  @Permisos('citas:escritura')
  crearSinCita(@Body() dto: CrearCitaSinCitaDto) {
    return this.citasService.crearSinCita(dto);
  }

  /**
   * POST /api/citas/riesgo-cancelacion
   * Calcula en lote las 18 variables de la libreta y ejecuta el Random Forest.
   * Solo personal autorizado: el puntaje sirve para priorizar recordatorios,
   * nunca para rechazar una cita.
   */
  @Post('riesgo-cancelacion')
  @Permisos('citas:escritura', 'citas:asignadas')
  async predecirRiesgoCancelacion(@Body() dto: PredecirRiesgoCitasDto) {
    const data = await this.riesgoCancelacionService.predecirLote(dto.citaIds);
    return { success: true, count: data.length, data };
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

  /**
   * PATCH /api/citas/:id (estado, notas, fechas, reasignación). Con escritura: cualquier cita;
   * becario ('citas:asignadas'): solo las suyas y sin reasignarlas (lo valida el servicio).
   */
  @Patch(':id')
  @Permisos('citas:escritura', 'citas:asignadas')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCitaDto, @Request() req: any) {
    return this.citasService.actualizar(id, dto, solicitanteDe(req));
  }

  /** PATCH /api/citas/:id/check-in */
  @Patch(':id/check-in')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  checkIn(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.citasService.checkIn(id, solicitanteDe(req));
  }

  /** PATCH /api/citas/:id/check-out */
  @Patch(':id/check-out')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  checkOut(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.citasService.checkOut(id, solicitanteDe(req));
  }

  /** PATCH /api/citas/:id/reprogramar. Clienta y becario: solo sus citas (lo valida el servicio). */
  @Patch(':id/reprogramar')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias', 'citas:propia')
  reprogramar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReprogramarCitaDto,
    @Request() req: any,
  ) {
    return this.citasService.reprogramar(id, dto, solicitanteDe(req));
  }

  /** PATCH /api/citas/:id/cancelar. Clienta y becario: solo sus citas (lo valida el servicio). */
  @Patch(':id/cancelar')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias', 'citas:propia')
  cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelarCitaDto,
    @Request() req: any,
  ) {
    return this.citasService.cancelar(id, dto, solicitanteDe(req));
  }

  /** POST /api/citas/:id/materiales */
  @Post(':id/materiales')
  @Permisos('citas:escritura', 'citas:asignadas', 'citas:propias')
  registrarMateriales(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MaterialesCitaDto,
    @Request() req: any,
  ) {
    return this.citasService.registrarMateriales(id, dto, solicitanteDe(req));
  }
}
