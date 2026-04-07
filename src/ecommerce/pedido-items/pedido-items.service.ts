import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreatePedidoItemDto } from './dto/create-pedido-item.dto';
import { UpdatePedidoItemDto } from './dto/update-pedido-item.dto';
import { precioPresentacionANumero } from '../../common/utils/money.util';

@Injectable()
export class PedidoItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  private async recalcularTotalesPedido(pedidoId: number) {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: { items: true },
    });
    if (!pedido) return;
    const subtotal =
      Math.round(
        pedido.items.reduce((s, i) => s + Number(i.subtotal), 0) * 100,
      ) / 100;
    const total =
      Math.round(
        (subtotal +
          Number(pedido.costoEnvio) +
          Number(pedido.impuestos) -
          Number(pedido.descuento)) *
          100,
      ) / 100;
    await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: { subtotal, total },
    });
  }

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.pedidoItem.findMany({
      where: { pedidoId },
      include: { producto: true, presentacion: true },
      orderBy: { id: 'asc' },
    });
    return { success: true, count: data.length, data };
  }

  async crear(solicitanteId: string, dto: CreatePedidoItemDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);
    const pres = await this.prisma.productoPresentacion.findUnique({
      where: { id: dto.presentacionId },
      include: { producto: true },
    });
    if (!pres) {
      throw new BadRequestException('Presentación no encontrada');
    }
    const productoId = pres.productoId;
    if (!pres.disponible || pres.stock < dto.cantidad) {
      throw new BadRequestException('Stock insuficiente');
    }
    const precioUnitario = precioPresentacionANumero(pres.precio);
    const subtotal =
      Math.round(precioUnitario * dto.cantidad * 100) / 100;

    const data = await this.prisma.pedidoItem.create({
      data: {
        pedidoId: dto.pedidoId,
        productoId,
        presentacionId: dto.presentacionId,
        cantidad: dto.cantidad,
        precioUnitario,
        subtotal,
        nombreProducto: pres.producto.nombre,
        tamanio: pres.tamanio,
      },
      include: { producto: true, presentacion: true },
    });
    await this.recalcularTotalesPedido(dto.pedidoId);
    return { success: true, data };
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdatePedidoItemDto,
  ) {
    const item = await this.prisma.pedidoItem.findUnique({
      where: { id },
      include: { presentacion: true, producto: true },
    });
    if (!item) throw new NotFoundException('Ítem de pedido no encontrado');
    await this.access.assertPedido(solicitanteId, item.pedidoId);

    const cantidad =
      dto.cantidad !== undefined ? dto.cantidad : item.cantidad;

    if (dto.cantidad !== undefined) {
      if (!item.presentacion.disponible || item.presentacion.stock < cantidad) {
        throw new BadRequestException('Stock insuficiente');
      }
      const precioUnitario = Number(item.precioUnitario);
      const subtotal = Math.round(precioUnitario * cantidad * 100) / 100;
      const data = await this.prisma.pedidoItem.update({
        where: { id },
        data: {
          cantidad,
          subtotal,
          ...(dto.nombreProducto !== undefined && {
            nombreProducto: dto.nombreProducto,
          }),
          ...(dto.tamanio !== undefined && { tamanio: dto.tamanio }),
        },
        include: { producto: true, presentacion: true },
      });
      await this.recalcularTotalesPedido(item.pedidoId);
      return { success: true, data };
    }

    const data = await this.prisma.pedidoItem.update({
      where: { id },
      data: {
        ...(dto.nombreProducto !== undefined && {
          nombreProducto: dto.nombreProducto,
        }),
        ...(dto.tamanio !== undefined && { tamanio: dto.tamanio }),
      },
      include: { producto: true, presentacion: true },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const item = await this.prisma.pedidoItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Ítem de pedido no encontrado');
    await this.access.assertPedido(solicitanteId, item.pedidoId);
    const pedidoId = item.pedidoId;
    await this.prisma.pedidoItem.delete({ where: { id } });
    await this.recalcularTotalesPedido(pedidoId);
    return { success: true, message: 'Ítem eliminado' };
  }
}
