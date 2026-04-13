import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Paquete, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaqueteDto } from './dto/create-paquete.dto';
import { UpdatePaqueteDto } from './dto/update-paquete.dto';
import { sanitizeInput, containsSQLInjection } from '../common/utils/security.util';

@Injectable()
export class PaquetesService {
  private readonly logger = new Logger(PaquetesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mensaje legible para el cliente cuando Prisma falla al persistir. */
  private mapPrismaPersistError(e: unknown): {
    message: string;
    code?: string;
  } {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return { message: 'Violación de unicidad en base de datos.', code: e.code };
      }
      return {
        message: `Error al guardar (${e.code}). Revisa que la base esté migrada y los datos sean válidos.`,
        code: e.code,
      };
    }
    if (e instanceof Prisma.PrismaClientValidationError) {
      return {
        message:
          'Los datos no coinciden con el esquema de la base (¿falta la tabla paquetes o una columna?). Ejecuta prisma migrate deploy o prisma db push.',
        code: 'VALIDATION',
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist|relation|no existe la relación|42P01/i.test(msg)) {
      return {
        message:
          'La tabla o relación de paquetes no existe en la base de datos. Aplica las migraciones de Prisma (migrate deploy / db push).',
        code: 'TABLE_MISSING',
      };
    }
    return { message: msg || 'No se pudo crear el paquete', code: 'UNKNOWN' };
  }

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
    if (!tipoSanitizado) {
      throw new BadRequestException({
        error: 'Datos inválidos',
        message:
          'El tipo de evento quedó vacío tras sanitizar. Evita solo caracteres filtrados (<, >, comillas, etc.).',
      });
    }
    if (containsSQLInjection(tipoSanitizado)) {
      throw new BadRequestException('Datos inválidos');
    }
    if (!Number.isFinite(dto.precio_especial)) {
      throw new BadRequestException({
        error: 'Datos inválidos',
        message: 'precio_especial debe ser un número finito (ej. 15000 o 12999.5).',
      });
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
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(
        `Paquete.create falló: ${e instanceof Error ? e.message : e}`,
      );
      const { message, code } = this.mapPrismaPersistError(e);
      throw new BadRequestException({
        error: 'Error creando paquete',
        message,
        ...(code ? { code } : {}),
      });
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Paquete no encontrado');
      }
      this.logger.warn(
        `Paquete.update falló: ${e instanceof Error ? e.message : e}`,
      );
      const { message, code } = this.mapPrismaPersistError(e);
      throw new BadRequestException({
        error: 'Error al actualizar el paquete',
        message,
        ...(code ? { code } : {}),
      });
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
