import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';

@Injectable()
export class EmpleadosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const perfiles = await this.prisma.perfilEmpleado.findMany({
      orderBy: { creadoEn: 'desc' },
      include: {
        usuario: {
          select: { id: true, nombre: true, email: true, telefono: true, rol: true, foto: true },
        },
      },
    });

    return { success: true, count: perfiles.length, data: perfiles };
  }

  async obtenerPorUsuario(usuarioId: string) {
    const perfil = await this.prisma.perfilEmpleado.findUnique({
      where: { usuarioId },
      include: {
        usuario: {
          select: { id: true, nombre: true, email: true, telefono: true, rol: true, foto: true },
        },
      },
    });

    if (!perfil) {
      throw new NotFoundException(`No se encontró perfil de empleado para el usuario ${usuarioId}`);
    }

    return { success: true, data: perfil };
  }

  async crear(dto: CreateEmpleadoDto) {
    const puestoLimpio = sanitizeInput(dto.puesto);
    if (containsSQLInjection(puestoLimpio)) {
      throw new BadRequestException('Puesto contiene caracteres no permitidos');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: dto.usuarioId },
      select: { id: true, nombre: true },
    });
    if (!usuario) {
      throw new NotFoundException(`Usuario ${dto.usuarioId} no encontrado`);
    }

    const existe = await this.prisma.perfilEmpleado.findUnique({
      where: { usuarioId: dto.usuarioId },
    });
    if (existe) {
      throw new ConflictException(`El usuario ${dto.usuarioId} ya tiene perfil de empleado`);
    }

    const perfil = await this.prisma.perfilEmpleado.create({
      data: {
        usuarioId: dto.usuarioId,
        puesto: puestoLimpio,
        especialidades: dto.especialidades ?? [],
        telefono: dto.telefono ? sanitizeInput(dto.telefono) : null,
        fechaIngreso: dto.fechaIngreso ? new Date(dto.fechaIngreso) : null,
        comisionPorcentaje: dto.comisionPorcentaje ?? null,
        activo: dto.activo ?? true,
      },
      include: {
        usuario: { select: { id: true, nombre: true, email: true, rol: true } },
      },
    });

    return { success: true, data: perfil };
  }

  async actualizar(usuarioId: string, dto: UpdateEmpleadoDto) {
    const perfil = await this.prisma.perfilEmpleado.findUnique({ where: { usuarioId } });
    if (!perfil) {
      throw new NotFoundException(`No se encontró perfil de empleado para el usuario ${usuarioId}`);
    }

    const data: Record<string, unknown> = {};

    if (dto.puesto !== undefined) {
      const limpio = sanitizeInput(dto.puesto);
      if (containsSQLInjection(limpio)) {
        throw new BadRequestException('Puesto contiene caracteres no permitidos');
      }
      data.puesto = limpio;
    }
    if (dto.especialidades !== undefined) data.especialidades = dto.especialidades;
    if (dto.telefono !== undefined) data.telefono = sanitizeInput(dto.telefono);
    if (dto.fechaIngreso !== undefined) data.fechaIngreso = new Date(dto.fechaIngreso);
    if (dto.comisionPorcentaje !== undefined) data.comisionPorcentaje = dto.comisionPorcentaje;
    if (dto.activo !== undefined) data.activo = dto.activo;

    const actualizado = await this.prisma.perfilEmpleado.update({
      where: { usuarioId },
      data,
      include: {
        usuario: { select: { id: true, nombre: true, email: true, rol: true } },
      },
    });

    return { success: true, data: actualizado };
  }

  async eliminar(usuarioId: string) {
    const perfil = await this.prisma.perfilEmpleado.findUnique({ where: { usuarioId } });
    if (!perfil) {
      throw new NotFoundException(`No se encontró perfil de empleado para el usuario ${usuarioId}`);
    }

    await this.prisma.perfilEmpleado.update({
      where: { usuarioId },
      data: { activo: false },
    });

    return { success: true, message: 'Perfil de empleado desactivado' };
  }
}
