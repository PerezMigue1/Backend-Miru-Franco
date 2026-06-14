import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { CreateQuejaDto } from './dto/create-queja.dto';
import { UpdateQuejaDto } from './dto/update-queja.dto';
import { ListQuejasDto } from './dto/list-quejas.dto';

@Injectable()
export class QuejasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: ListQuejasDto) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.estado)    where.estado    = query.estado;
    if (query.clienteId) where.usuarioId = query.clienteId;

    const [total, quejas] = await this.prisma.$transaction([
      this.prisma.queja.count({ where }),
      this.prisma.queja.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
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
      data: quejas,
    };
  }

  async obtener(id: number) {
    const queja = await this.prisma.queja.findUnique({
      where: { id },
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });
    if (!queja) throw new NotFoundException(`Queja ${id} no encontrada`);
    return { success: true, data: queja };
  }

  async listarPorCliente(clienteId: string) {
    const quejas = await this.prisma.queja.findMany({
      where: { usuarioId: clienteId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: quejas.length, data: quejas };
  }

  /**
   * Admin: puede especificar usuarioId en el body.
   * Cliente: se asigna automáticamente a su propio usuario.
   */
  async crear(dto: CreateQuejaDto, solicitanteId: string, solicitanteRol: string) {
    const asuntoLimpio = sanitizeInput(dto.asunto);
    const descLimpia   = sanitizeInput(dto.descripcion);

    if (containsSQLInjection(asuntoLimpio) || containsSQLInjection(descLimpia)) {
      throw new BadRequestException('Los campos contienen caracteres no permitidos');
    }

    const usuarioId =
      solicitanteRol === 'admin' && dto.usuarioId ? dto.usuarioId : solicitanteId;

    const usuarioExiste = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true },
    });
    if (!usuarioExiste) throw new NotFoundException(`Usuario ${usuarioId} no encontrado`);

    const queja = await this.prisma.queja.create({
      data: {
        asunto:      asuntoLimpio,
        descripcion: descLimpia,
        usuarioId,
      },
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });

    return { success: true, data: queja };
  }

  async actualizar(id: number, dto: UpdateQuejaDto, solicitanteRol: string) {
    if (solicitanteRol !== 'admin') {
      throw new ForbiddenException('Solo admin puede actualizar quejas');
    }

    const queja = await this.prisma.queja.findUnique({ where: { id } });
    if (!queja) throw new NotFoundException(`Queja ${id} no encontrada`);

    const data: Record<string, unknown> = {};

    if (dto.asunto !== undefined) {
      const limpio = sanitizeInput(dto.asunto);
      if (containsSQLInjection(limpio)) throw new BadRequestException('Asunto inválido');
      data.asunto = limpio;
    }
    if (dto.descripcion !== undefined) {
      const limpio = sanitizeInput(dto.descripcion);
      if (containsSQLInjection(limpio)) throw new BadRequestException('Descripción inválida');
      data.descripcion = limpio;
    }
    if (dto.estado !== undefined) {
      data.estado = dto.estado;
      // Auto-asignar resueltaEn si no se especifica explícitamente
      if ((dto.estado === 'resuelta' || dto.estado === 'cerrada') && !dto.resueltaEn) {
        data.resueltaEn = new Date();
      }
    }
    if (dto.resueltaEn !== undefined) {
      data.resueltaEn = new Date(dto.resueltaEn);
    }

    const actualizado = await this.prisma.queja.update({
      where: { id },
      data,
      include: {
        usuario: { select: { id: true, nombre: true, email: true } },
      },
    });

    return { success: true, data: actualizado };
  }
}
