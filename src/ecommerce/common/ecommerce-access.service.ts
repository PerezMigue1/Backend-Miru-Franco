import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EcommerceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getRol(usuarioId: string): Promise<string | null> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rol: true },
    });
    return u?.rol ?? null;
  }

  isAdmin(rol: string | null): boolean {
    return rol === 'admin';
  }

  assertOwnerOrAdmin(
    currentUserId: string,
    resourceOwnerId: string,
    rol: string | null,
  ): void {
    if (this.isAdmin(rol)) return;
    if (currentUserId !== resourceOwnerId) {
      throw new ForbiddenException(
        'No tienes permiso para acceder a este recurso',
      );
    }
  }

  async assertDireccionUsuario(
    usuarioId: string,
    direccionId: string,
  ): Promise<void> {
    const rol = await this.getRol(usuarioId);
    const dir = await this.prisma.direccionUsuario.findUnique({
      where: { id: direccionId },
      select: { usuarioId: true },
    });
    if (!dir) throw new NotFoundException('Dirección no encontrada');
    this.assertOwnerOrAdmin(usuarioId, dir.usuarioId, rol);
  }

  async assertPedido(
    usuarioId: string,
    pedidoId: number,
  ): Promise<{ usuarioIdPedido: string }> {
    const rol = await this.getRol(usuarioId);
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { usuarioId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    this.assertOwnerOrAdmin(usuarioId, pedido.usuarioId, rol);
    return { usuarioIdPedido: pedido.usuarioId };
  }

  async getPedidoUsuarioId(pedidoId: number): Promise<string> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { usuarioId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    return pedido.usuarioId;
  }
}
