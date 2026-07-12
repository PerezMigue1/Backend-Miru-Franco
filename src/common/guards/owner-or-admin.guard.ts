import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Permite el acceso solo si el usuario autenticado es admin, o si el `:id` de la ruta
 * coincide con su propio id (self-service). Requiere ejecutarse después de JwtAuthGuard
 * (necesita `request.user` ya poblado, incluido `rol`).
 */
@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string; rol?: string } | undefined;
    const targetId = request.params?.id;

    const esAdmin = user?.rol === 'admin';
    const esDueño = !!user?.id && user.id === targetId;

    if (!esAdmin && !esDueño) {
      throw new ForbiddenException('No tienes permiso para acceder a este recurso');
    }

    return true;
  }
}
