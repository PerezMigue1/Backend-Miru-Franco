import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoPago, Pago, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { esCobroEnEfectivoDelSalon, registrarSalidaEfectivo, TX_HOLGADA } from '../../pos/salidas-caja';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { puedeVerPedidosDeOtros } from '../common/permisos-pedido.util';
import { bloquearReembolsosDelPedido } from '../devoluciones/devoluciones.service';
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
    // Los pagos de anticipos de citas se consultan y gestionan desde la cita (/citas/:id/anticipo).
    if (!pago || pago.pedidoId === null) throw new NotFoundException('Pago no encontrado');
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
        // Cobrado en el salón: cuándo y quién, para que entre en el corte de caja de esa persona.
        ...(dto.estado === 'aprobado' && { pagadoEn: new Date(), cobradoPorId: solicitanteId }),
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
    if (!pago || pago.pedidoId === null) throw new NotFoundException('Pago no encontrado');
    await this.assertPuedeGestionarPago(pago.pedidoId, solicitanteId, rolUsuario, permisosUsuario);

    if (dto.estado === EstadoPago.reembolsado) return this.reembolsar(pago, solicitanteId, dto);

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
        ...(dto.metodo !== undefined && { metodo: dto.metodo }),
        // Se aprueba ahora sin fecha de cobro previa: cuándo y quién, para el corte de caja.
        ...(dto.estado === 'aprobado' && !pago.pagadoEn && dto.pagadoEn === undefined && { pagadoEn: new Date(), cobradoPorId: solicitanteId }),
      },
    });
    return { success: true, data };
  }

  /**
   * Reembolso de un cobro: solo desde aprobado o en revisión, una sola vez. En la misma transacción se guarda
   * cuándo y, si el cobro entró en efectivo a la caja del salón, la salida de caja de quien reembolsa (se
   * descuenta en su siguiente corte, aunque el cobro sea de un día ya cortado).
   */
  private async reembolsar(pago: Pago, solicitanteId: string, dto: UpdatePagoDto) {
    try {
      const data = await this.prisma.$transaction(async (tx) => {
        if (pago.pedidoId !== null) {
          // Mismo candado que aprobar devoluciones: el dinero del pedido no sale por las dos vías.
          await bloquearReembolsosDelPedido(tx, pago.pedidoId);
          const porDevolucion = await tx.devolucion.count({
            where: { pedidoId: pago.pedidoId, estado: 'aprobada', tipo: 'reembolso' },
          });
          if (porDevolucion > 0) {
            throw new ConflictException('El pedido ya tiene reembolsos por devolución; gestiona desde devoluciones');
          }
        }
        const r = await tx.pago.updateMany({
          where: { id: pago.id, estado: { in: [EstadoPago.aprobado, EstadoPago.en_revision] } },
          data: {
            estado: EstadoPago.reembolsado,
            reembolsadoEn: new Date(),
            ...(dto.referenciaExterna !== undefined && { referenciaExterna: dto.referenciaExterna }),
            ...(dto.errorMensaje !== undefined && { errorMensaje: dto.errorMensaje }),
            ...(dto.payload !== undefined && { payload: dto.payload as object }),
          },
        });
        if (r.count !== 1) {
          throw new ConflictException(
            pago.estado === EstadoPago.reembolsado ? 'Este pago ya se reembolsó' : 'Solo se reembolsa un pago aprobado o en revisión',
          );
        }
        if (esCobroEnEfectivoDelSalon(pago)) {
          await registrarSalidaEfectivo(tx, {
            concepto: 'reembolso_pedido',
            monto: pago.monto,
            registradoPorId: solicitanteId,
            pagoId: pago.id,
            motivo: `Reembolso del pedido ${pago.pedidoId}`,
          });
        }
        return tx.pago.findUnique({ where: { id: pago.id } });
      }, TX_HOLGADA);
      return { success: true, data };
    } catch (e) {
      // Dos reembolsos simultáneos: la llave única de la salida (pago_id) rechaza el segundo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Este pago ya se reembolsó');
      }
      throw e;
    }
  }
}
