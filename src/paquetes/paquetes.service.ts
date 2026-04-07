import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Paquete } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaqueteDto } from './dto/create-paquete.dto';
import { UpdatePaqueteDto } from './dto/update-paquete.dto';
import { sanitizeInput, containsSQLInjection } from '../common/utils/security.util';

@Injectable()
export class PaquetesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Serializa fila Prisma: Decimal → number para el admin. */
  private toRow(p: Paquete) {
    return {
      id: p.id,
      tipo_evento: p.tipo_evento,
      descripcion: p.descripcion,
      servicios_vinculados: p.servicios_vinculados,
      precio_especial: Number(p.precio_especial),
    };
  }

  async findAll() {
    try {
      const rows = await this.prisma.paquete.findMany({
        orderBy: { id: 'asc' },
      });
      return { data: rows.map((p) => this.toRow(p)) };
    } catch {
      throw new BadRequestException('Error al obtener paquetes');
    }
  }

  async findOne(id: string) {
    const idNumero = parseInt(id, 10);
    if (isNaN(idNumero)) throw new BadRequestException('ID no válido');

    const paquete = await this.prisma.paquete.findUnique({
      where: { id: idNumero },
    });

    if (!paquete) throw new NotFoundException('Paquete no encontrado');
    return { data: this.toRow(paquete) };
  }

  async create(dto: CreatePaqueteDto) {
    const tipoSanitizado = sanitizeInput(dto.tipo_evento);
    if (containsSQLInjection(tipoSanitizado)) {
      throw new BadRequestException('Datos inválidos');
    }

    try {
      const created = await this.prisma.paquete.create({
        data: {
          tipo_evento: tipoSanitizado,
          descripcion: dto.descripcion?.trim() ?? '',
          servicios_vinculados: dto.servicios_vinculados ?? [],
          precio_especial: dto.precio_especial,
        },
      });
      return { data: this.toRow(created) };
    } catch {
      throw new BadRequestException('No se pudo crear el paquete');
    }
  }

  async update(id: string, dto: UpdatePaqueteDto) {
    const idNumero = parseInt(id, 10);
    if (isNaN(idNumero)) throw new BadRequestException('ID no válido');

    const data: {
      tipo_evento?: string;
      descripcion?: string;
      servicios_vinculados?: string[];
      precio_especial?: number;
    } = {};

    if (dto.tipo_evento !== undefined) {
      const t = sanitizeInput(dto.tipo_evento);
      if (containsSQLInjection(t)) {
        throw new BadRequestException('Datos de actualización inválidos');
      }
      data.tipo_evento = t;
    }
    if (dto.descripcion !== undefined) data.descripcion = dto.descripcion;
    if (dto.servicios_vinculados !== undefined) {
      data.servicios_vinculados = dto.servicios_vinculados;
    }
    if (dto.precio_especial !== undefined) {
      data.precio_especial = dto.precio_especial;
    }

    if (Object.keys(data).length === 0) {
      const current = await this.prisma.paquete.findUnique({
        where: { id: idNumero },
      });
      if (!current) throw new NotFoundException('Paquete no encontrado');
      return { data: this.toRow(current) };
    }

    try {
      const updated = await this.prisma.paquete.update({
        where: { id: idNumero },
        data,
      });
      return { data: this.toRow(updated) };
    } catch {
      throw new BadRequestException('Error al actualizar el paquete');
    }
  }

  async remove(id: string) {
    const idNumero = parseInt(id, 10);
    if (isNaN(idNumero)) throw new BadRequestException('ID no válido');

    try {
      const deleted = await this.prisma.paquete.delete({
        where: { id: idNumero },
      });
      return { data: this.toRow(deleted) };
    } catch {
      throw new NotFoundException('El paquete no existe o ya fue eliminado');
    }
  }
}
