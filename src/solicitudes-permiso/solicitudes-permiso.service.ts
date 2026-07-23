import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSolicitudPermisoDto } from './dto/create-solicitud-permiso.dto';
import { ResolverSolicitudPermisoDto } from './dto/resolver-solicitud-permiso.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class SolicitudesPermisoService {
  constructor(private readonly prisma: PrismaService) {}

  private incluirRelaciones() {
    return {
      usuario: { select: { id: true, nombre: true, email: true } },
      resueltoPor: { select: { id: true, nombre: true } },
    } as const;
  }

  async listar() {
    const solicitudes = await this.prisma.solicitudPermiso.findMany({
      include: this.incluirRelaciones(),
      orderBy: { creadoEn: 'desc' },
    });

    return { success: true, count: solicitudes.length, data: solicitudes };
  }

  async listarMias(usuarioId: string) {
    const solicitudes = await this.prisma.solicitudPermiso.findMany({
      where: { usuarioId },
      include: this.incluirRelaciones(),
      orderBy: { creadoEn: 'desc' },
    });

    return { success: true, count: solicitudes.length, data: solicitudes };
  }

  async crear(usuarioId: string, dto: CreateSolicitudPermisoDto) {
    const motivoSanitizado = sanitizeInput(dto.motivo);
    if (containsSQLInjection(motivoSanitizado)) {
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    const fechaInicio = new Date(dto.fechaInicio);
    const fechaFin = new Date(dto.fechaFin);
    if (fechaFin < fechaInicio) {
      throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio');
    }

    const solicitud = await this.prisma.solicitudPermiso.create({
      data: {
        tipo: dto.tipo,
        fechaInicio,
        fechaFin,
        motivo: motivoSanitizado,
        usuarioId,
      },
      include: this.incluirRelaciones(),
    });

    console.log('✅ Solicitud de permiso creada:', sanitizeForLogging({ id: solicitud.id, usuarioId }));

    return { success: true, message: 'Solicitud registrada correctamente', data: solicitud };
  }

  async resolver(id: number, resueltoPorId: string, dto: ResolverSolicitudPermisoDto) {
    const existe = await this.prisma.solicitudPermiso.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Solicitud no encontrada');
    }
    if (existe.estado !== 'pendiente') {
      throw new BadRequestException('Esta solicitud ya fue resuelta');
    }

    const comentarioSanitizado = dto.comentarioResolucion ? sanitizeInput(dto.comentarioResolucion) : null;
    if (comentarioSanitizado && containsSQLInjection(comentarioSanitizado)) {
      throw new BadRequestException('Comentario inválido');
    }

    const solicitud = await this.prisma.solicitudPermiso.update({
      where: { id },
      data: {
        estado: dto.estado,
        resueltoPorId,
        comentarioResolucion: comentarioSanitizado,
      },
      include: this.incluirRelaciones(),
    });

    console.log('✅ Solicitud de permiso resuelta:', sanitizeForLogging({ id, estado: dto.estado, resueltoPorId }));

    return { success: true, message: 'Solicitud resuelta correctamente', data: solicitud };
  }
}
