import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateHistorialEstadoPedidoDto } from './dto/create-historial-estado-pedido.dto';

@Injectable()
export class HistorialEstadoPedidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.historialEstadoPedido.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'asc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const row = await this.prisma.historialEstadoPedido.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Registro de historial no encontrado');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    return { success: true, data: row };
  }

  async crear(solicitanteId: string, dto: CreateHistorialEstadoPedidoDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);
    const usuarioId = dto.usuarioId ?? solicitanteId;
    const data = await this.prisma.historialEstadoPedido.create({
      data: {
        pedidoId: dto.pedidoId,
        estadoAnterior: dto.estadoAnterior ?? null,
        estadoNuevo: dto.estadoNuevo,
        origen: dto.origen ?? null,
        usuarioId,
      },
    });
    return { success: true, data };
  }
}
