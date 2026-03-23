import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreatePagoDto } from './dto/create-pago.dto';
import { UpdatePagoDto } from './dto/update-pago.dto';

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.pago.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const pago = await this.prisma.pago.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    await this.access.assertPedido(solicitanteId, pago.pedidoId);
    return { success: true, data: pago };
  }

  async crear(solicitanteId: string, dto: CreatePagoDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);
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

  async actualizar(id: number, solicitanteId: string, dto: UpdatePagoDto) {
    const pago = await this.prisma.pago.findUnique({ where: { id } });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    await this.access.assertPedido(solicitanteId, pago.pedidoId);

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
