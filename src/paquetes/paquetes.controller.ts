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
  UseGuards,
} from '@nestjs/common';
import { PaquetesService } from './paquetes.service';
import { CreatePaqueteDto } from './dto/create-paquete.dto';
import { UpdatePaqueteDto } from './dto/update-paquete.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard, Permisos } from '../common/guards/permisos.guard';

@Controller('paquetes')
@UseGuards(JwtAuthGuard, PermisosGuard)
export class PaquetesController {
  constructor(private readonly paquetesService: PaquetesService) {}

  @Get()
  @Permisos('servicios:lectura')
  async findAll() {
    return this.paquetesService.findAll();
  }

  @Get(':id')
  @Permisos('servicios:lectura')
  async findOne(@Param('id') id: string) {
    return this.paquetesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permisos('servicios:escritura')
  async create(@Body() createPaqueteDto: CreatePaqueteDto) {
    return this.paquetesService.create(createPaqueteDto);
  }

  @Patch(':id')
  @Permisos('servicios:escritura')
  async update(@Param('id') id: string, @Body() updatePaqueteDto: UpdatePaqueteDto) {
    return this.paquetesService.update(id, updatePaqueteDto);
  }

  @Delete(':id')
  @Permisos('servicios:escritura')
  async remove(@Param('id') id: string) {
    return this.paquetesService.remove(id);
  }
}
