import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';

@Injectable()
export class FacturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.factura.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    return { success: true, data: row };
  }

  async crear(solicitanteId: string, dto: CreateFacturaDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);
    const data = await this.prisma.factura.create({
      data: {
        pedidoId: dto.pedidoId,
        uuidFiscal: dto.uuidFiscal ?? null,
        folio: dto.folio ?? null,
        serie: dto.serie ?? null,
        xmlUrl: dto.xmlUrl ?? null,
        pdfUrl: dto.pdfUrl ?? null,
        estado: dto.estado ?? null,
      },
    });
    return { success: true, data };
  }

  async actualizar(id: number, solicitanteId: string, dto: UpdateFacturaDto) {
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);

    const data = await this.prisma.factura.update({
      where: { id },
      data: {
        ...(dto.uuidFiscal !== undefined && { uuidFiscal: dto.uuidFiscal }),
        ...(dto.folio !== undefined && { folio: dto.folio }),
        ...(dto.serie !== undefined && { serie: dto.serie }),
        ...(dto.xmlUrl !== undefined && { xmlUrl: dto.xmlUrl }),
        ...(dto.pdfUrl !== undefined && { pdfUrl: dto.pdfUrl }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    await this.prisma.factura.delete({ where: { id } });
    return { success: true, message: 'Factura eliminada' };
  }
}
