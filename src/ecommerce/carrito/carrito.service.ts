import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateCarritoItemDto } from './dto/create-carrito-item.dto';
import { UpdateCarritoItemDto } from './dto/update-carrito-item.dto';

@Injectable()
export class CarritoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listar(solicitanteId: string, filtroUsuarioId?: string) {
    const rol = await this.access.getRol(solicitanteId);
    let targetUserId = solicitanteId;
    if (filtroUsuarioId) {
      if (!this.access.isAdmin(rol)) {
        throw new ForbiddenException(
          'Solo administradores pueden ver el carrito de otro usuario',
        );
      }
      targetUserId = filtroUsuarioId;
    }

    const data = await this.prisma.carritoItem.findMany({
      where: { usuarioId: targetUserId, activo: true },
      include: { producto: true, presentacion: true },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const item = await this.prisma.carritoItem.findUnique({
      where: { id },
      include: { producto: true, presentacion: true },
    });
    if (!item) throw new NotFoundException('Ítem de carrito no encontrado');
    this.access.assertOwnerOrAdmin(
      solicitanteId,
      item.usuarioId,
      await this.access.getRol(solicitanteId),
    );
    return { success: true, data: item };
  }

  async upsert(solicitanteId: string, dto: CreateCarritoItemDto) {
    const pres = await this.prisma.productoPresentacion.findUnique({
      where: { id: dto.presentacionId },
    });
    if (!pres || pres.productoId !== dto.productoId) {
      throw new BadRequestException(
        'Presentación no válida para el producto indicado',
      );
    }
    if (!pres.disponible) {
      throw new BadRequestException('Presentación no disponible');
    }

    const data = await this.prisma.carritoItem.upsert({
      where: {
        usuarioId_presentacionId: {
          usuarioId: solicitanteId,
          presentacionId: dto.presentacionId,
        },
      },
      create: {
        usuarioId: solicitanteId,
        productoId: dto.productoId,
        presentacionId: dto.presentacionId,
        cantidad: dto.cantidad,
        precioReferencia: dto.precioReferencia ?? null,
        activo: true,
      },
      update: {
        cantidad: dto.cantidad,
        ...(dto.precioReferencia !== undefined && {
          precioReferencia: dto.precioReferencia,
        }),
        activo: true,
      },
      include: { producto: true, presentacion: true },
    });
    return { success: true, data };
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdateCarritoItemDto,
  ) {
    const item = await this.prisma.carritoItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Ítem de carrito no encontrado');
    this.access.assertOwnerOrAdmin(
      solicitanteId,
      item.usuarioId,
      await this.access.getRol(solicitanteId),
    );

    if (dto.cantidad !== undefined) {
      const pres = await this.prisma.productoPresentacion.findUnique({
        where: { id: item.presentacionId },
      });
      if (pres && pres.stock < dto.cantidad) {
        throw new ForbiddenException('Stock insuficiente');
      }
    }

    const data = await this.prisma.carritoItem.update({
      where: { id },
      data: {
        ...(dto.cantidad !== undefined && { cantidad: dto.cantidad }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
        ...(dto.precioReferencia !== undefined && {
          precioReferencia: dto.precioReferencia,
        }),
      },
      include: { producto: true, presentacion: true },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const item = await this.prisma.carritoItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Ítem de carrito no encontrado');
    this.access.assertOwnerOrAdmin(
      solicitanteId,
      item.usuarioId,
      await this.access.getRol(solicitanteId),
    );
    await this.prisma.carritoItem.delete({ where: { id } });
    return { success: true, message: 'Ítem eliminado del carrito' };
  }
}
