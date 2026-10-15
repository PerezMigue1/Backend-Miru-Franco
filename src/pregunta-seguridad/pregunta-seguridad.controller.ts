import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PreguntaSeguridadService } from './pregunta-seguridad.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { CreatePreguntaDto } from './dto/create-pregunta.dto';
import { UpdatePreguntaDto } from './dto/update-pregunta.dto';
import { EliminarPreguntaDto } from './dto/eliminar-pregunta.dto';
import { VerificarRespuestaDto } from './dto/verificar-respuesta.dto';

@Controller('pregunta-seguridad')
export class PreguntaSeguridadController {
  constructor(private readonly preguntaSeguridadService: PreguntaSeguridadService) {}

  @Get()
  // Removido JwtAuthGuard para permitir acceso público a las preguntas de seguridad
  // Las preguntas son públicas, solo la verificación de respuestas requiere autenticación
  async obtenerPreguntas() {
    return this.preguntaSeguridadService.obtenerPreguntas();
  }

  // Misma política que POST /api/auth/pregunta-seguridad (la web usa esa; esta queda para otras apps).
  @Get('por-email')
  @UseGuards(new RateLimitGuard(3, 60000))
  async obtenerPreguntaPorEmail(@Query('email') email: string) {
    if (!email) {
      throw new BadRequestException('El correo es obligatorio');
    }
    return this.preguntaSeguridadService.obtenerPreguntaPorEmail(email);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async obtenerPorId(@Param('id') id: string) {
    return this.preguntaSeguridadService.obtenerPorId(id);
  }

  /**
   * Establece o actualiza la pregunta y respuesta de recuperación del usuario autenticado (la
   * respuesta se guarda hasheada con bcrypt). El email del DTO se ignora: cada quien solo puede
   * cambiar su propia pregunta. Pide passwordActual (cuentas con contraseña); las de Google no usan pregunta.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, new RateLimitGuard(5, 60000))
  async crearPregunta(
    @Req() req: { user?: { id?: string } },
    @Body() createPreguntaDto: CreatePreguntaDto,
  ) {
    return this.preguntaSeguridadService.crearPregunta(
      req.user?.id,
      createPreguntaDto.pregunta,
      createPreguntaDto.respuesta,
      createPreguntaDto.passwordActual,
    );
  }

  // Misma política que POST /api/auth/verificar-respuesta.
  @Post('verificar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(new RateLimitGuard(3, 60000))
  async verificarRespuesta(@Body() verificarRespuestaDto: VerificarRespuestaDto) {
    return this.preguntaSeguridadService.verificarRespuesta(
      verificarRespuestaDto.email,
      verificarRespuestaDto.answers,
    );
  }

  /**
   * Gestión del catálogo preguntas_disponibles (solo admin): renombrar o activar/desactivar una
   * pregunta; con un id nuevo, la crea. La web no usa esta ruta: queda para el panel de admin.
   * Pide passwordActual de quien hace el cambio (cuentas con contraseña).
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, new RateLimitGuard(5, 60000))
  @Roles('admin')
  async actualizarPregunta(
    @Req() req: { user?: { id?: string } },
    @Param('id') id: string,
    @Body() updatePreguntaDto: UpdatePreguntaDto,
  ) {
    return this.preguntaSeguridadService.actualizarPregunta(id, updatePreguntaDto, req.user?.id);
  }

  /**
   * Desactiva una pregunta del catálogo preguntas_disponibles (solo admin, soft delete). Pide passwordActual en el
   * cuerpo (cuentas con contraseña).
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, new RateLimitGuard(5, 60000))
  @Roles('admin')
  async eliminarPregunta(
    @Req() req: { user?: { id?: string } },
    @Param('id') id: string,
    @Body() eliminarPreguntaDto: EliminarPreguntaDto,
  ) {
    return this.preguntaSeguridadService.eliminarPregunta(id, req.user?.id, eliminarPreguntaDto?.passwordActual);
  }
}

