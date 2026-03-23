import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { UpdateDevolucionDto } from './dto/update-devolucion.dto';

@Injectable()
export class DevolucionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.devolucion.findMany({
      where: { pedidoId },
      include: { pedidoItem: true, pago: true },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const row = await this.prisma.devolucion.findUnique({
      where: { id },
      include: { pedidoItem: true, pago: true },
    });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    return { success: true, data: row };
  }

  private async validarRefs(dto: {
    pedidoId: number;
    pedidoItemId?: number | null;
    pagoId?: number | null;
  }) {
    if (dto.pedidoItemId != null) {
      const item = await this.prisma.pedidoItem.findUnique({
        where: { id: dto.pedidoItemId },
      });
      if (!item || item.pedidoId !== dto.pedidoId) {
        throw new BadRequestException(
          'El ítem del pedido no pertenece al pedido indicado',
        );
      }
    }
    if (dto.pagoId != null) {
      const pago = await this.prisma.pago.findUnique({
        where: { id: dto.pagoId },
      });
      if (!pago || pago.pedidoId !== dto.pedidoId) {
        throw new BadRequestException(
          'El pago no pertenece al pedido indicado',
        );
      }
    }
  }

  async crear(solicitanteId: string, dto: CreateDevolucionDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);
    await this.validarRefs(dto);

    const data = await this.prisma.devolucion.create({
      data: {
        pedidoId: dto.pedidoId,
        pedidoItemId: dto.pedidoItemId ?? null,
        pagoId: dto.pagoId ?? null,
        estado: dto.estado,
        motivo: dto.motivo ?? null,
        monto: dto.monto ?? null,
      },
      include: { pedidoItem: true, pago: true },
    });
    return { success: true, data };
  }

  async actualizar(id: number, solicitanteId: string, dto: UpdateDevolucionDto) {
    const row = await this.prisma.devolucion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);

    const pedidoId = row.pedidoId;
    await this.validarRefs({
      pedidoId,
      pedidoItemId:
        dto.pedidoItemId !== undefined ? dto.pedidoItemId : row.pedidoItemId,
      pagoId: dto.pagoId !== undefined ? dto.pagoId : row.pagoId,
    });

    const data = await this.prisma.devolucion.update({
      where: { id },
      data: {
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.motivo !== undefined && { motivo: dto.motivo }),
        ...(dto.monto !== undefined && { monto: dto.monto }),
        ...(dto.pedidoItemId !== undefined && {
          pedidoItemId: dto.pedidoItemId,
        }),
        ...(dto.pagoId !== undefined && { pagoId: dto.pagoId }),
      },
      include: { pedidoItem: true, pago: true },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const row = await this.prisma.devolucion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Devolución no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    await this.prisma.devolucion.delete({ where: { id } });
    return { success: true, message: 'Devolución eliminada' };
  }
}
