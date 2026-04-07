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
import { Roles, RolesGuard } from '../common/guards/roles.guard';

@Controller('paquetes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PaquetesController {
  constructor(private readonly paquetesService: PaquetesService) {}

  @Get()
  async findAll() {
    return this.paquetesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.paquetesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createPaqueteDto: CreatePaqueteDto) {
    return this.paquetesService.create(createPaqueteDto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updatePaqueteDto: UpdatePaqueteDto) {
    return this.paquetesService.update(id, updatePaqueteDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.paquetesService.remove(id);
  }
}
