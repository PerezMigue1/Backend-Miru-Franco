import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { RecomendacionesService } from './recomendaciones.service';
import { RecomendarDto } from './dto/recomendar.dto';

/**
 * Endpoint público (sin guard): se consume desde el carrito de la
 * tienda y desde el flujo de agendado de citas para sugerir
 * productos/servicios al cliente. No expone datos sensibles, solo
 * nombres de servicios/productos y métricas de la regla.
 */
@Controller('recomendaciones')
export class RecomendacionesController {
  constructor(private readonly recomendacionesService: RecomendacionesService) {}

  /**
   * GET /api/recomendaciones?items=Corte de Cabello Dama,Botox Capilar&topN=5
   * Pensado para llamadas rápidas desde el frontend con query string.
   */
  @Get()
  async recomendarPorQuery(
    @Query('items') items?: string,
    @Query('topN') topN?: string,
    @Query('tipo') tipo?: string,
  ) {
    const lista = (items ?? '')
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean);

    return this.recomendacionesService.recomendar(
      lista,
      topN ? Number(topN) : undefined,
      tipo,
    );
  }

  /**
   * POST /api/recomendaciones
   * Pensado para el carrito de la tienda / carrito de la cita, donde
   * los ítems ya existen como arreglo en el estado del frontend.
   */
  @Post()
  async recomendarPorBody(@Body() dto: RecomendarDto) {
    return this.recomendacionesService.recomendar(dto.items, dto.topN, dto.tipo);
  }
}
