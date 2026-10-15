import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../../common/guards/permisos.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISO_REEMBOLSOS, ReembolsosPendientesService } from './reembolsos-pendientes.service';

export class MarcarReembolsoManualDto {
  @IsString({ message: 'Escribe la referencia del reembolso.' })
  @MaxLength(120, { message: 'La referencia tiene como máximo 120 caracteres.' })
  referencia: string;

  @IsOptional()
  @IsString({ message: 'La nota debe ser texto.' })
  @MaxLength(500, { message: 'La nota tiene como máximo 500 caracteres.' })
  nota?: string;
}

/** Admin > Reembolsos pendientes (permiso reembolsos:gestionar; por omisión solo admin). */
@Controller('reembolsos-pendientes')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos(PERMISO_REEMBOLSOS)
export class ReembolsosPendientesController {
  constructor(private readonly servicio: ReembolsosPendientesService) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Post(':id/reintentar')
  @HttpCode(HttpStatus.OK)
  reintentar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: string }) {
    return this.servicio.reintentar(id, user.id);
  }

  @Post(':id/marcar-manual')
  @HttpCode(HttpStatus.OK)
  marcarManual(@Param('id', ParseIntPipe) id: number, @Body() dto: MarcarReembolsoManualDto, @CurrentUser() user: { id: string }) {
    return this.servicio.marcarManual(id, dto, user.id);
  }
}
