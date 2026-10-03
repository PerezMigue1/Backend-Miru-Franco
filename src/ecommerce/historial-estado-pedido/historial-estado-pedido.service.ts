import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { puedeGestionarPedidos } from '../common/permisos-pedido.util';
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

  /**
   * Solo el personal que gestiona pedidos (admin o caja:escritura) escribe filas a mano; la clienta
   * nunca. El autor es siempre quien la escribe (se ignora dto.usuarioId).
   */
  async crear(solicitanteId: string, dto: CreateHistorialEstadoPedidoDto) {
    const rol = await this.access.getRol(solicitanteId);
    if (!(await puedeGestionarPedidos(this.prisma, rol))) {
      throw new ForbiddenException('Solo el personal del salón registra cambios de estado');
    }
    const pedido = await this.prisma.pedido.findUnique({ where: { id: dto.pedidoId }, select: { id: true } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    const usuarioId = solicitanteId;
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
