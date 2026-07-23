import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { puedeVerPedidosDeOtros } from '../common/permisos-pedido.util';
import { CreatePagoDto } from './dto/create-pago.dto';
import { UpdatePagoDto } from './dto/update-pago.dto';

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  /**
   * Acceso a escritura de pagos: dueño del pedido, admin, o quien tenga `caja:escritura`
   * (cobro físico en el salón — la estilista dueña, no el cliente ni el técnico admin).
   * Acotado a PagosService: NO reutiliza `EcommerceAccessService.assertOwnerOrAdmin`
   * (compartido con direcciones/pedidos) para no tocar comportamiento fuera de pagos.
   * Mismo mensaje/shape de error que `assertOwnerOrAdmin` para no cambiar el contrato.
   */
  private async assertPuedeGestionarPago(
    pedidoId: number,
    solicitanteId: string,
    rolUsuario?: string,
    permisosUsuario?: string[],
  ): Promise<void> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { usuarioId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const esDueño = pedido.usuarioId === solicitanteId;
    const esAdmin = rolUsuario === 'admin';
    const tieneCaja = !!permisosUsuario?.includes('caja:escritura');

    if (!esDueño && !esAdmin && !tieneCaja) {
      throw new ForbiddenException('No tienes permiso para acceder a este recurso');
    }
  }

  /**
   * Lectura de pagos de un pedido: dueño del pedido, admin, o quien tenga
   * `caja:escritura` (la estilista necesita ver el pago de una clienta para
   * poder cobrarlo). Mismo criterio único que PedidosService — `puedeVerPedidosDeOtros`.
   */
  private async assertLecturaPago(solicitanteId: string, pedidoId: number): Promise<void> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { usuarioId: true },
    });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.usuarioId === solicitanteId) return;

    const rol = await this.access.getRol(solicitanteId);
    const puedeVerOtros = await puedeVerPedidosDeOtros(this.prisma, rol);
    if (!puedeVerOtros) {
      throw new ForbiddenException('No tienes permiso para acceder a este recurso');
    }
  }

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.assertLecturaPago(solicitanteId, pedidoId);
    const data = await this.prisma.pago.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const pago = await this.prisma.pago.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    await this.assertLecturaPago(solicitanteId, pago.pedidoId);
    return { success: true, data: pago };
  }

  async crear(
    solicitanteId: string,
    dto: CreatePagoDto,
    rolUsuario?: string,
    permisosUsuario?: string[],
  ) {
    await this.assertPuedeGestionarPago(dto.pedidoId, solicitanteId, rolUsuario, permisosUsuario);
    const data = await this.prisma.pago.create({
      data: {
        pedidoId: dto.pedidoId,
        intentoNumero: dto.intentoNumero,
        monto: dto.monto,
        moneda: dto.moneda ?? 'MXN',
        metodo: dto.metodo,
        proveedor: dto.proveedor ?? null,
        ...(dto.estado !== undefined && { estado: dto.estado }),
        referenciaExterna: dto.referenciaExterna ?? null,
        errorMensaje: dto.errorMensaje ?? null,
        payload: dto.payload === undefined ? undefined : (dto.payload as object),
      },
    });
    return { success: true, data };
  }

  async actualizar(
    id: number,
    solicitanteId: string,
    dto: UpdatePagoDto,
    rolUsuario?: string,
    permisosUsuario?: string[],
  ) {
    const pago = await this.prisma.pago.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    await this.assertPuedeGestionarPago(pago.pedidoId, solicitanteId, rolUsuario, permisosUsuario);

    const data = await this.prisma.pago.update({
      where: { id },
      data: {
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.referenciaExterna !== undefined && {
          referenciaExterna: dto.referenciaExterna,
        }),
        ...(dto.errorMensaje !== undefined && {
          errorMensaje: dto.errorMensaje,
        }),
        ...(dto.payload !== undefined && { payload: dto.payload as object }),
        ...(dto.pagadoEn !== undefined && {
          pagadoEn: dto.pagadoEn ? new Date(dto.pagadoEn) : null,
        }),
        ...(dto.monto !== undefined && { monto: dto.monto }),
      },
    });
    return { success: true, data };
  }
}
