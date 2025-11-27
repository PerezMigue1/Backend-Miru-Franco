import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { PreguntaSeguridadService } from './pregunta-seguridad.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreatePreguntaDto } from './dto/create-pregunta.dto';
import { UpdatePreguntaDto } from './dto/update-pregunta.dto';
import { VerificarRespuestaDto } from './dto/verificar-respuesta.dto';

@Controller('pregunta-seguridad')
export class PreguntaSeguridadController {
  constructor(private readonly preguntaSeguridadService: PreguntaSeguridadService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async obtenerPreguntas() {
    return this.preguntaSeguridadService.obtenerPreguntas();
  }

  @Get('por-email')
  async obtenerPreguntaPorEmail(@Query('email') email: string) {
    if (!email) {
      return { success: false, message: 'email es requerido' };
    }
    return this.preguntaSeguridadService.obtenerPreguntaPorEmail(email);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async obtenerPorId(@Param('id') id: string) {
    return this.preguntaSeguridadService.obtenerPorId(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async crearPregunta(@Body() createPreguntaDto: CreatePreguntaDto) {
    return this.preguntaSeguridadService.crearPregunta(
      createPreguntaDto.pregunta,
      createPreguntaDto.email,
      createPreguntaDto.respuesta,
    );
  }

  @Post('verificar')
  @HttpCode(HttpStatus.OK)
  async verificarRespuesta(@Body() verificarRespuestaDto: VerificarRespuestaDto) {
    return this.preguntaSeguridadService.verificarRespuesta(
      verificarRespuestaDto.email,
      verificarRespuestaDto.answers,
    );
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async actualizarPregunta(
    @Param('id') id: string,
    @Body() updatePreguntaDto: UpdatePreguntaDto,
  ) {
    return this.preguntaSeguridadService.actualizarPregunta(id, updatePreguntaDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async eliminarPregunta(@Param('id') id: string) {
    return this.preguntaSeguridadService.eliminarPregunta(id);
  }
}

