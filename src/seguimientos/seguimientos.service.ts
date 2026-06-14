import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { CreateSeguimientoDto } from './dto/create-seguimiento.dto';
import { UpdateSeguimientoDto } from './dto/update-seguimiento.dto';
import { ListSeguimientosDto } from './dto/list-seguimientos.dto';

@Injectable()
export class SeguimientosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: ListSeguimientosDto) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.clienteId !== undefined)   where.usuarioId     = query.clienteId;
    if (query.requiereAccion !== undefined) where.requiereAccion = query.requiereAccion;

    const [total, seguimientos] = await this.prisma.$transaction([
      this.prisma.seguimientoPostServicio.count({ where }),
      this.prisma.seguimientoPostServicio.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaContacto: 'desc' },
        include: {
          usuario: { select: { id: true, nombre: true, email: true } },
        },
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: seguimientos,
    };
  }

  async obtener(id: number) {
    const seg = await this.prisma.seguimientoPostServicio.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });
    if (!seg) throw new NotFoundException(`Seguimiento ${id} no encontrado`);
    return { success: true, data: seg };
  }

  async listarPorCliente(clienteId: string) {
    const segs = await this.prisma.seguimientoPostServicio.findMany({
      where: { usuarioId: clienteId },
      orderBy: { fechaContacto: 'desc' },
    });
    return { success: true, count: segs.length, data: segs };
  }

  async crear(dto: CreateSeguimientoDto) {
    const notasLimpias = sanitizeInput(dto.notas);
    if (containsSQLInjection(notasLimpias)) {
      throw new BadRequestException('Notas contienen caracteres no permitidos');
    }

    const usuarioExiste = await this.prisma.usuario.findUnique({
      where: { id: dto.usuarioId },
      select: { id: true },
    });
    if (!usuarioExiste) throw new NotFoundException(`Usuario ${dto.usuarioId} no encontrado`);

    const seg = await this.prisma.seguimientoPostServicio.create({
      data: {
        usuarioId:     dto.usuarioId,
        notas:         notasLimpias,
        fechaContacto: new Date(dto.fechaContacto),
        satisfaccion:  dto.satisfaccion ?? null,
        requiereAccion: dto.requiereAccion,
      },
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });

    return { success: true, data: seg };
  }

  async actualizar(id: number, dto: UpdateSeguimientoDto) {
    const seg = await this.prisma.seguimientoPostServicio.findUnique({ where: { id } });
    if (!seg) throw new NotFoundException(`Seguimiento ${id} no encontrado`);

    const data: Record<string, unknown> = {};

    if (dto.notas !== undefined) {
      const limpio = sanitizeInput(dto.notas);
      if (containsSQLInjection(limpio)) throw new BadRequestException('Notas inválidas');
      data.notas = limpio;
    }
    if (dto.fechaContacto  !== undefined) data.fechaContacto  = new Date(dto.fechaContacto);
    if (dto.satisfaccion   !== undefined) data.satisfaccion   = dto.satisfaccion;
    if (dto.requiereAccion !== undefined) data.requiereAccion = dto.requiereAccion;

    const actualizado = await this.prisma.seguimientoPostServicio.update({
      where: { id },
      data,
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });

    return { success: true, data: actualizado };
  }
}
