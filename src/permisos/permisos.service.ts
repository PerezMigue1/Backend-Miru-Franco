import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePermisosRolDto } from './dto/update-permisos-rol.dto';

@Injectable()
export class PermisosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const permisos = await this.prisma.permisoRol.findMany({
      orderBy: { rol: 'asc' },
    });
    return { success: true, count: permisos.length, data: permisos };
  }

  async listarPorRol(rol: string) {
    const permiso = await this.prisma.permisoRol.findUnique({ where: { rol } });
    if (!permiso) {
      throw new NotFoundException(`No se encontraron permisos para el rol '${rol}'`);
    }
    return { success: true, data: permiso };
  }

  async actualizarPorRol(rol: string, dto: UpdatePermisosRolDto) {
    const resultado = await this.prisma.permisoRol.upsert({
      where: { rol },
      update: { claves: dto.claves },
      create: { rol, claves: dto.claves },
    });
    return { success: true, data: resultado };
  }

  /** Devuelve las claves de permiso del usuario (útil para debug / introspección de sesión). */
  async clavesDelUsuario(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rol: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const permisoRol = await this.prisma.permisoRol.findUnique({
      where: { rol: usuario.rol },
      select: { claves: true },
    });

    return {
      success: true,
      data: {
        rol: usuario.rol,
        claves: permisoRol?.claves ?? [],
      },
    };
  }
}
