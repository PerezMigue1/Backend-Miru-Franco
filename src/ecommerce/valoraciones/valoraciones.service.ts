import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateValoracionDto } from './dto/create-valoracion.dto';
import { UpdateValoracionDto } from './dto/update-valoracion.dto';

@Injectable()
export class ValoracionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  /**
   * Lista valoraciones del usuario autenticado.
   * Admin: sin `usuarioId` devuelve todas; con `?usuarioId=` filtra por ese usuario.
   */
  async listar(solicitanteId: string, filtroUsuarioId?: string) {
    const rol = await this.access.getRol(solicitanteId);
    let where: Prisma.ValoracionWhereInput = {};

    if (this.access.isAdmin(rol)) {
      if (filtroUsuarioId) {
        where = { usuarioId: filtroUsuarioId };
      }
    } else {
      if (filtroUsuarioId) {
        throw new ForbiddenException(
          'Solo administradores pueden filtrar valoraciones por usuarioId',
        );
      }
      where = { usuarioId: solicitanteId };
    }

    const data = await this.prisma.valoracion.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      include: {
        producto: { select: { id: true, nombre: true } },
        pedido: { select: { id: true, estado: true } },
      },
    });
    return { success: true, count: data.length, data };
  }

  async listarPorProducto(productoId: number) {
    const data = await this.prisma.valoracion.findMany({
      where: { productoId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.valoracion.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const row = await this.prisma.valoracion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Valoración no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    return { success: true, data: row };
  }

  async crear(solicitanteId: string, dto: CreateValoracionDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);

    const enPedido = await this.prisma.pedidoItem.findFirst({
      where: { pedidoId: dto.pedidoId, productoId: dto.productoId },
    });
    if (!enPedido) {
      throw new BadRequestException(
        'El producto no forma parte de este pedido; no se puede valorar',
      );
    }

    try {
      const data = await this.prisma.valoracion.create({
        data: {
          usuarioId: solicitanteId,
          productoId: dto.productoId,
          pedidoId: dto.pedidoId,
          puntuacion: dto.puntuacion,
          comentario: dto.comentario ?? null,
        },
      });
      return { success: true, data };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya valoraste este producto (solo una valoración por producto y usuario)',
        );
      }
      throw e;
    }
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdateValoracionDto,
  ) {
    const row = await this.prisma.valoracion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Valoración no encontrada');
    const rol = await this.access.getRol(solicitanteId);
    this.access.assertOwnerOrAdmin(solicitanteId, row.usuarioId, rol);

    const data = await this.prisma.valoracion.update({
      where: { id },
      data: {
        ...(dto.puntuacion !== undefined && { puntuacion: dto.puntuacion }),
        ...(dto.comentario !== undefined && { comentario: dto.comentario }),
      },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const row = await this.prisma.valoracion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Valoración no encontrada');
    const rol = await this.access.getRol(solicitanteId);
    this.access.assertOwnerOrAdmin(solicitanteId, row.usuarioId, rol);
    await this.prisma.valoracion.delete({ where: { id } });
    return { success: true, message: 'Valoración eliminada' };
  }
}
