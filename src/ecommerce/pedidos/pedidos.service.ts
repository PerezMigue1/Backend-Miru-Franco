import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoPedido, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { UpdatePedidoDto } from './dto/update-pedido.dto';
import { PedidoItemLineDto } from './dto/pedido-item-line.dto';
import { precioPresentacionANumero } from '../../common/utils/money.util';
import {
  cantidadPorPresentacion,
  decrementarStockPresentaciones,
  incrementarStockPorLineas,
} from '../common/pedido-inventario.util';

@Injectable()
export class PedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  private includeDefault(): Prisma.PedidoInclude {
    return {
      items: { include: { producto: true, presentacion: true } },
      direccionEnvio: true,
      usuario: { select: { id: true, nombre: true, email: true } },
    };
  }

  async listar(
    solicitanteId: string,
    filtros?: {
      usuarioId?: string;
      estado?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      metodoPago?: string;
      q?: string;
      sort?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const rol = await this.access.getRol(solicitanteId);
    const {
      usuarioId: filtroUsuarioId,
      estado,
      fechaDesde,
      fechaHasta,
      metodoPago,
      q,
      sort,
      page = 1,
      limit = 20,
    } = filtros ?? {};
    const where: Prisma.PedidoWhereInput = {};

    if (filtroUsuarioId) {
      if (!this.access.isAdmin(rol)) {
        throw new ForbiddenException(
          'Solo administradores pueden filtrar pedidos por usuarioId',
        );
      }
      where.usuarioId = filtroUsuarioId;
    } else if (!this.access.isAdmin(rol)) {
      where.usuarioId = solicitanteId;
    }

    if (estado) {
      if (!Object.values(EstadoPedido).includes(estado as EstadoPedido)) {
        throw new BadRequestException(`Estado de pedido inválido: ${estado}`);
      }
      where.estado = estado as EstadoPedido;
    }

    if (metodoPago) {
      where.metodoPago = { contains: metodoPago, mode: 'insensitive' };
    }

    if (fechaDesde || fechaHasta) {
      const gte = fechaDesde ? new Date(fechaDesde) : undefined;
      const lte = fechaHasta ? new Date(fechaHasta) : undefined;
      if ((gte && Number.isNaN(gte.getTime())) || (lte && Number.isNaN(lte.getTime()))) {
        throw new BadRequestException('fechaDesde/fechaHasta deben ser fechas ISO válidas');
      }
      where.creadoEn = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    if (q && q.trim().length > 0) {
      const term = q.trim();
      const byId = Number.parseInt(term, 10);
      const orConditions: Prisma.PedidoWhereInput[] = [
        { usuario: { is: { nombre: { contains: term, mode: 'insensitive' } } } },
        { usuario: { is: { email: { contains: term, mode: 'insensitive' } } } },
        { usuario: { is: { telefono: { contains: term, mode: 'insensitive' } } } },
        { metodoPago: { contains: term, mode: 'insensitive' } },
        { referenciaPago: { contains: term, mode: 'insensitive' } },
      ];
      if (!Number.isNaN(byId)) {
        orConditions.push({ id: byId });
      }
      where.OR = orConditions;
    }

    let orderBy: Prisma.PedidoOrderByWithRelationInput = { creadoEn: 'desc' };
    if (sort) {
      const normalized = sort.trim().toLowerCase();
      if (normalized === 'creadoen:asc') {
        orderBy = { creadoEn: 'asc' };
      } else if (normalized === 'creadoen:desc') {
        orderBy = { creadoEn: 'desc' };
      } else {
        throw new BadRequestException(
          'sort inválido. Usa creadoEn:asc o creadoEn:desc',
        );
      }
    }

    const skip = (page - 1) * limit;
    const total = await this.prisma.pedido.count({ where });
    const data = await this.prisma.pedido.findMany({
      where,
      include: this.includeDefault(),
      orderBy,
      skip,
      take: limit,
    });
    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data,
    };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, id);
    const data = await this.prisma.pedido.findUnique({
      where: { id },
      include: this.includeDefault(),
    });
    if (!data) throw new NotFoundException('Pedido no encontrado');
    return { success: true, data };
  }

  private async validarItems(lines: PedidoItemLineDto[]) {
    const detalles: {
      productoId: number;
      presentacionId: number;
      cantidad: number;
      precioUnitario: number;
      subtotal: number;
      nombreProducto: string | null;
      tamanio: string | null;
    }[] = [];

    for (const line of lines) {
      const pres = await this.prisma.productoPresentacion.findUnique({
        where: { id: line.presentacionId },
        include: { producto: true },
      });
      if (!pres) {
        throw new NotFoundException(
          `Presentación ${line.presentacionId} no encontrada`,
        );
      }
      // productoId canónico desde BD (el cliente puede enviar un productoId desfasado del carrito)
      const productoId = pres.productoId;
      if (!pres.disponible || pres.stock < line.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente o presentación no disponible (producto ${pres.producto.nombre})`,
        );
      }
      const precioUnitario = precioPresentacionANumero(pres.precio);
      const subtotal = Math.round(precioUnitario * line.cantidad * 100) / 100;
      detalles.push({
        productoId,
        presentacionId: line.presentacionId,
        cantidad: line.cantidad,
        precioUnitario,
        subtotal,
        nombreProducto: pres.producto.nombre,
        tamanio: pres.tamanio,
      });
    }
    return detalles;
  }

  async crear(solicitanteId: string, dto: CreatePedidoDto) {
    const rol = await this.access.getRol(solicitanteId);
    let usuarioId = solicitanteId;
    if (dto.usuarioId) {
      if (!this.access.isAdmin(rol)) {
        throw new ForbiddenException(
          'Solo un administrador puede crear pedidos para otro usuario',
        );
      }
      usuarioId = dto.usuarioId;
    }

    if (dto.direccionEnvioId) {
      const dir = await this.prisma.direccionUsuario.findUnique({
        where: { id: dto.direccionEnvioId },
      });
      if (!dir || dir.usuarioId !== usuarioId) {
        throw new BadRequestException(
          'La dirección de envío no existe o no pertenece al usuario del pedido',
        );
      }
    }

    const detalles = await this.validarItems(dto.items);
    const subtotal =
      Math.round(
        detalles.reduce((s, d) => s + d.subtotal, 0) * 100,
      ) / 100;
    const costoEnvio = 0;
    const impuestos = 0;
    const descuento = 0;
    const total =
      Math.round((subtotal + costoEnvio + impuestos - descuento) * 100) / 100;

    const estado = dto.estado ?? EstadoPedido.borrador;
    const moneda = dto.moneda ?? 'MXN';

    const data = await this.prisma.$transaction(async (tx) => {
      const cantidades = cantidadPorPresentacion(
        detalles.map((d) => ({
          presentacionId: d.presentacionId,
          cantidad: d.cantidad,
        })),
      );
      await decrementarStockPresentaciones(tx, cantidades);

      const pedido = await tx.pedido.create({
        data: {
          usuarioId,
          direccionEnvioId: dto.direccionEnvioId ?? null,
          estado,
          subtotal,
          costoEnvio,
          impuestos,
          descuento,
          total,
          moneda,
          notasCliente: dto.notasCliente ?? null,
          metodoPago: dto.metodoPago ?? null,
          referenciaPago: dto.referenciaPago ?? null,
          items: {
            create: detalles.map((d) => ({
              productoId: d.productoId,
              presentacionId: d.presentacionId,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              subtotal: d.subtotal,
              nombreProducto: d.nombreProducto,
              tamanio: d.tamanio,
            })),
          },
        },
        include: this.includeDefault(),
      });

      await tx.historialEstadoPedido.create({
        data: {
          pedidoId: pedido.id,
          estadoAnterior: null,
          estadoNuevo: estado,
          origen: 'api.crear_pedido',
          usuarioId: solicitanteId,
        },
      });

      return pedido;
    });

    return { success: true, data };
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdatePedidoDto,
  ) {
    const { usuarioIdPedido } = await this.access.assertPedido(
      solicitanteId,
      id,
    );
    const actual = await this.prisma.pedido.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Pedido no encontrado');

    if (dto.direccionEnvioId) {
      const dir = await this.prisma.direccionUsuario.findUnique({
        where: { id: dto.direccionEnvioId },
      });
      if (!dir || dir.usuarioId !== usuarioIdPedido) {
        throw new BadRequestException(
          'La dirección de envío no existe o no pertenece al titular del pedido',
        );
      }
    }

    const rol = await this.access.getRol(solicitanteId);
    const data = await this.prisma.$transaction(async (tx) => {
      const itemsStock = await tx.pedidoItem.findMany({
        where: { pedidoId: id },
        select: { presentacionId: true, cantidad: true },
      });

      const estadoAnterior = actual.estado;
      const updateData: Prisma.PedidoUpdateInput = {
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.direccionEnvioId !== undefined && {
          direccionEnvio: dto.direccionEnvioId
            ? { connect: { id: dto.direccionEnvioId } }
            : { disconnect: true },
        }),
        ...(dto.direccionTextoCompleta !== undefined && {
          direccionTextoCompleta: dto.direccionTextoCompleta,
        }),
        ...(dto.notasCliente !== undefined && {
          notasCliente: dto.notasCliente,
        }),
        ...(dto.moneda !== undefined && { moneda: dto.moneda }),
        ...(dto.costoEnvio !== undefined && { costoEnvio: dto.costoEnvio }),
        ...(dto.impuestos !== undefined && { impuestos: dto.impuestos }),
        ...(dto.descuento !== undefined && { descuento: dto.descuento }),
        ...(dto.metodoPago !== undefined && { metodoPago: dto.metodoPago }),
        ...(dto.referenciaPago !== undefined && {
          referenciaPago: dto.referenciaPago,
        }),
      };

      if (!this.access.isAdmin(rol)) {
        delete (updateData as any).estado;
        delete (updateData as any).costoEnvio;
        delete (updateData as any).impuestos;
        delete (updateData as any).descuento;
      }

      const keys = Object.keys(updateData).filter(
        (k) => (updateData as any)[k] !== undefined,
      );
      if (keys.length === 0) {
        throw new BadRequestException('No hay campos permitidos para actualizar');
      }

      if (
        this.access.isAdmin(rol) &&
        dto.estado !== undefined &&
        dto.estado !== estadoAnterior
      ) {
        if (
          dto.estado === EstadoPedido.cancelado &&
          estadoAnterior !== EstadoPedido.cancelado
        ) {
          await incrementarStockPorLineas(tx, itemsStock);
        } else if (
          dto.estado !== EstadoPedido.cancelado &&
          estadoAnterior === EstadoPedido.cancelado
        ) {
          await decrementarStockPresentaciones(
            tx,
            cantidadPorPresentacion(itemsStock),
          );
        }
      }

      const updated = await tx.pedido.update({
        where: { id },
        data: updateData,
        include: this.includeDefault(),
      });

      if (
        dto.estado !== undefined &&
        dto.estado !== estadoAnterior &&
        this.access.isAdmin(rol)
      ) {
        await tx.historialEstadoPedido.create({
          data: {
            pedidoId: id,
            estadoAnterior,
            estadoNuevo: dto.estado,
            origen: 'api.actualizar_pedido_admin',
            usuarioId: solicitanteId,
          },
        });
      }

      return updated;
    });

    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const rol = await this.access.getRol(solicitanteId);
    if (!this.access.isAdmin(rol)) {
      throw new ForbiddenException('Solo administradores pueden eliminar pedidos');
    }
    await this.access.assertPedido(solicitanteId, id);
    const pedidoRow = await this.prisma.pedido.findUnique({
      where: { id },
      select: { estado: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const itemsStock = await tx.pedidoItem.findMany({
        where: { pedidoId: id },
        select: { presentacionId: true, cantidad: true },
      });
      if (pedidoRow?.estado !== EstadoPedido.cancelado) {
        await incrementarStockPorLineas(tx, itemsStock);
      }
      await tx.pedido.delete({ where: { id } });
    });
    return { success: true, message: 'Pedido eliminado' };
  }
}
