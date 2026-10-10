import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreatePedidoItemDto } from './dto/create-pedido-item.dto';
import { UpdatePedidoItemDto } from './dto/update-pedido-item.dto';
import { precioPresentacionANumero } from '../../common/utils/money.util';
import {
  decrementarStockPresentaciones,
  incrementarStockPresentaciones,
} from '../common/pedido-inventario.util';

/** La clienta solo cambia los productos antes de que el salón empiece a preparar su pedido. */
const ESTADOS_EDITABLES_POR_CLIENTA: EstadoPedido[] = [EstadoPedido.borrador, EstadoPedido.pendiente_pago];

@Injectable()
export class PedidoItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  private async recalcularTotalesPedido(
    client: Prisma.TransactionClient | PrismaService,
    pedidoId: number,
  ) {
    const pedido = await client.pedido.findUnique({
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
    await client.pedido.update({
      where: { id: pedidoId },
      data: { subtotal, total },
    });
  }

  async listarPorPedido(pedidoId: number, solicitanteId: string, propios = false) {
    await this.access.assertPedido(solicitanteId, pedidoId, propios);
    const data = await this.prisma.pedidoItem.findMany({
      where: { pedidoId },
      include: { producto: true, presentacion: true },
      orderBy: { id: 'asc' },
    });
    return { success: true, count: data.length, data };
  }

  /**
   * Quién puede cambiar los artículos: la dueña (o el admin) y nunca en un pedido cancelado. La clienta
   * además solo mientras el pedido está en borrador o pendiente de pago, antes de que se prepare.
   */
  private async assertPuedeEditarArticulos(solicitanteId: string, pedidoId: number) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { estado: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.estado === EstadoPedido.cancelado) {
      throw new BadRequestException('No se pueden cambiar los productos de un pedido cancelado');
    }
    const rol = await this.access.getRol(solicitanteId);
    if (!this.access.isAdmin(rol) && !ESTADOS_EDITABLES_POR_CLIENTA.includes(pedido.estado)) {
      throw new ForbiddenException('Ya no puedes cambiar los productos de este pedido: el salón ya lo está preparando.');
    }
  }

  async crear(solicitanteId: string, dto: CreatePedidoItemDto) {
    await this.assertPuedeEditarArticulos(solicitanteId, dto.pedidoId);
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

    const data = await this.prisma.$transaction(async (tx) => {
      await decrementarStockPresentaciones(
        tx,
        new Map([[dto.presentacionId, dto.cantidad]]),
        {
          usuarioId: solicitanteId,
          referenciaTipo: 'pedido_item',
          referenciaId: String(dto.pedidoId),
          motivo: 'pedido_item_creado',
        },
      );
      const row = await tx.pedidoItem.create({
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
      await this.recalcularTotalesPedido(tx, dto.pedidoId);
      return row;
    });
    return { success: true, data };
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdatePedidoItemDto,
    pedidoId: number,
  ) {
    const item = await this.prisma.pedidoItem.findUnique({
      where: { id },
      include: { presentacion: true, producto: true },
    });
    // El artículo tiene que ser del pedido de la URL: no se edita uno ajeno cambiando el pedidoId.
    if (!item || item.pedidoId !== pedidoId) throw new NotFoundException('Ítem de pedido no encontrado');
    await this.assertPuedeEditarArticulos(solicitanteId, item.pedidoId);

    const cantidad =
      dto.cantidad !== undefined ? dto.cantidad : item.cantidad;

    if (dto.cantidad !== undefined) {
      const delta = cantidad - item.cantidad;
      if (delta > 0) {
        const pres = item.presentacion;
        if (!pres.disponible || pres.stock < delta) {
          throw new BadRequestException('Stock insuficiente');
        }
      }
      const precioUnitario = Number(item.precioUnitario);
      const subtotal = Math.round(precioUnitario * cantidad * 100) / 100;
      const data = await this.prisma.$transaction(async (tx) => {
        if (delta !== 0) {
          if (delta > 0) {
            await decrementarStockPresentaciones(
              tx,
              new Map([[item.presentacionId, delta]]),
              {
                usuarioId: solicitanteId,
                referenciaTipo: 'pedido_item',
                referenciaId: String(id),
                motivo: 'pedido_item_cantidad_incrementada',
              },
            );
          } else {
            await incrementarStockPresentaciones(
              tx,
              new Map([[item.presentacionId, -delta]]),
              {
                usuarioId: solicitanteId,
                referenciaTipo: 'pedido_item',
                referenciaId: String(id),
                motivo: 'pedido_item_cantidad_reducida',
              },
            );
          }
        }
        const row = await tx.pedidoItem.update({
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
        await this.recalcularTotalesPedido(tx, item.pedidoId);
        return row;
      });
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

  async eliminar(id: number, solicitanteId: string, pedidoIdUrl: number) {
    const item = await this.prisma.pedidoItem.findUnique({ where: { id } });
    if (!item || item.pedidoId !== pedidoIdUrl) throw new NotFoundException('Ítem de pedido no encontrado');
    await this.assertPuedeEditarArticulos(solicitanteId, item.pedidoId);
    const pedidoId = item.pedidoId;
    await this.prisma.$transaction(async (tx) => {
      await incrementarStockPresentaciones(
        tx,
        new Map([[item.presentacionId, item.cantidad]]),
        {
          usuarioId: solicitanteId,
          referenciaTipo: 'pedido_item',
          referenciaId: String(id),
          motivo: 'pedido_item_eliminado',
        },
      );
      await tx.pedidoItem.delete({ where: { id } });
      await this.recalcularTotalesPedido(tx, pedidoId);
    });
    return { success: true, message: 'Ítem eliminado' };
  }
}
