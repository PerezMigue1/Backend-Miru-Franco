import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

/** Decora un handler con las claves de permiso requeridas (ANY match). */
export const Permisos = (...permisos: string[]) => SetMetadata('permisos', permisos);

/**
 * Guard de permisos fino, independiente de RolesGuard.
 *
 * - Si el rol tiene la clave '*' → acceso total (admin).
 * - Para los demás, se verifica que el array del rol incluya
 *   al menos una de las claves declaradas con @Permisos().
 *
 * Tras la verificación, adjunta al request:
 *   request.permisosUsuario → string[] (claves del rol)
 *   request.rolUsuario      → string   (rol del usuario)
 * para que los services apliquen filtros de scope (ej. citas:propias vs citas:asignadas).
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const clavesRequeridas = this.reflector.get<string[]>('permisos', context.getHandler());

    if (!clavesRequeridas || clavesRequeridas.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string } | undefined;

    if (!user?.id) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: user.id },
      select: { rol: true },
    });

    if (!usuario) {
      throw new ForbiddenException('Usuario no encontrado');
    }

    const permisoRol = await this.prisma.permisoRol.findUnique({
      where: { rol: usuario.rol },
      select: { claves: true },
    });

    if (!permisoRol) {
      throw new ForbiddenException({
        message: 'Rol sin permisos configurados',
        code: 'NO_PERMISSIONS',
      });
    }

    // Adjuntar para uso downstream en services
    request.permisosUsuario = permisoRol.claves;
    request.rolUsuario = usuario.rol;

    // Wildcard: admin accede a todo
    if (permisoRol.claves.includes('*')) {
      return true;
    }

    const tienePermiso = clavesRequeridas.some((clave) =>
      permisoRol.claves.includes(clave),
    );

    if (!tienePermiso) {
      throw new ForbiddenException({
        message: 'No tienes los permisos necesarios para esta acción',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }

    return true;
  }
}
