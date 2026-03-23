import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateNotificacionDto } from './dto/create-notificacion.dto';
import { UpdateNotificacionDto } from './dto/update-notificacion.dto';

@Injectable()
export class NotificacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listar(
    solicitanteId: string,
    opts?: { usuarioId?: string; leida?: boolean },
  ) {
    const rol = await this.access.getRol(solicitanteId);
    let targetUserId = solicitanteId;
    if (opts?.usuarioId) {
      if (!this.access.isAdmin(rol)) {
        throw new ForbiddenException(
          'Solo administradores pueden filtrar notificaciones de otro usuario',
        );
      }
      targetUserId = opts.usuarioId;
    }

    const where: { usuarioId: string; leida?: boolean } = {
      usuarioId: targetUserId,
    };
    if (opts?.leida !== undefined) {
      where.leida = opts.leida;
    }

    const data = await this.prisma.notificacion.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: string, solicitanteId: string) {
    const row = await this.prisma.notificacion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Notificación no encontrada');
    this.access.assertOwnerOrAdmin(
      solicitanteId,
      row.usuarioId,
      await this.access.getRol(solicitanteId),
    );
    return { success: true, data: row };
  }

  async crearAdmin(dto: CreateNotificacionDto) {
    const data = await this.prisma.notificacion.create({
      data: {
        usuarioId: dto.usuarioId,
        tipo: dto.tipo,
        titulo: dto.titulo,
        mensaje: dto.mensaje,
        leida: dto.leida ?? false,
        metadata:
          dto.metadata === undefined ? undefined : (dto.metadata as object),
      },
    });
    return { success: true, data };
  }

  async actualizar(
    id: string,
    solicitanteId: string,
    dto: UpdateNotificacionDto,
  ) {
    const row = await this.prisma.notificacion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Notificación no encontrada');
    this.access.assertOwnerOrAdmin(
      solicitanteId,
      row.usuarioId,
      await this.access.getRol(solicitanteId),
    );

    const data = await this.prisma.notificacion.update({
      where: { id },
      data: {
        ...(dto.tipo !== undefined && { tipo: dto.tipo }),
        ...(dto.titulo !== undefined && { titulo: dto.titulo }),
        ...(dto.mensaje !== undefined && { mensaje: dto.mensaje }),
        ...(dto.leida !== undefined && { leida: dto.leida }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as object }),
      },
    });
    return { success: true, data };
  }

  async eliminar(id: string, solicitanteId: string) {
    const row = await this.prisma.notificacion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Notificación no encontrada');
    const rol = await this.access.getRol(solicitanteId);
    this.access.assertOwnerOrAdmin(solicitanteId, row.usuarioId, rol);
    await this.prisma.notificacion.delete({ where: { id } });
    return { success: true, message: 'Notificación eliminada' };
  }
}
