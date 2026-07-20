import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  /** Todas las facturas/notas (con o sin pedido) — usado por el panel de administración. */
  async listarTodas() {
    const data = await this.prisma.factura.findMany({
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');
    if (row.pedidoId != null) {
      await this.access.assertPedido(solicitanteId, row.pedidoId);
    }
    return { success: true, data: row };
  }

  async crear(solicitanteId: string, dto: CreateFacturaDto) {
    if (dto.pedidoId != null) {
      await this.access.assertPedido(solicitanteId, dto.pedidoId);
    }

    // Regla de negocio: un CFDI debe traer al menos folio o UUID fiscal (el sistema nunca
    // los genera — vienen del PAC/contador y los captura quien registra el documento).
    // Excepción: una SOLICITUD de cliente (estado 'solicitada') aún no tiene folio/UUID —
    // esos los captura el admin al timbrar/registrar el documento después.
    if (dto.tipo === 'cfdi' && dto.estado !== 'solicitada' && !dto.folio && !dto.uuidFiscal) {
      throw new BadRequestException('Un CFDI requiere al menos folio o UUID fiscal');
    }

    const data = await this.prisma.factura.create({
      data: {
        tipo: dto.tipo,
        pedidoId: dto.pedidoId ?? null,
        creadoPorId: solicitanteId,
        clienteNombre: dto.tipo === 'nota' ? (dto.clienteNombre ?? null) : null,
        concepto: dto.tipo === 'nota' ? (dto.concepto ?? null) : null,
        monto: dto.tipo === 'nota' ? (dto.monto ?? null) : null,
        uuidFiscal: dto.uuidFiscal ?? null,
        folio: dto.folio ?? null,
        serie: dto.serie ?? null,
        rfc: dto.rfc ?? null,
        razonSocial: dto.razonSocial ?? null,
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
    if (row.pedidoId != null) {
      await this.access.assertPedido(solicitanteId, row.pedidoId);
    }

    // Regla de negocio: una solicitud (estado 'solicitada') puede crearse sin folio/UUID,
    // pero al salir de ese estado (timbrarla/registrarla) un CFDI ya debe traer datos fiscales
    // — ya sea que los aporte este update o que la factura ya los tuviera guardados.
    const estadoResultante = dto.estado !== undefined ? dto.estado : row.estado;
    if (row.tipo === 'cfdi' && estadoResultante !== 'solicitada') {
      const folio = dto.folio !== undefined ? dto.folio : row.folio;
      const uuidFiscal = dto.uuidFiscal !== undefined ? dto.uuidFiscal : row.uuidFiscal;
      if (!folio && !uuidFiscal) {
        throw new BadRequestException(
          'Un CFDI requiere folio o UUID fiscal para ser registrado/timbrado',
        );
      }
    }

    const data = await this.prisma.factura.update({
      where: { id },
      data: {
        ...(dto.uuidFiscal !== undefined && { uuidFiscal: dto.uuidFiscal }),
        ...(dto.folio !== undefined && { folio: dto.folio }),
        ...(dto.serie !== undefined && { serie: dto.serie }),
        ...(dto.rfc !== undefined && { rfc: dto.rfc }),
        ...(dto.razonSocial !== undefined && { razonSocial: dto.razonSocial }),
        ...(dto.xmlUrl !== undefined && { xmlUrl: dto.xmlUrl }),
        ...(dto.pdfUrl !== undefined && { pdfUrl: dto.pdfUrl }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.clienteNombre !== undefined && { clienteNombre: dto.clienteNombre }),
        ...(dto.concepto !== undefined && { concepto: dto.concepto }),
        ...(dto.monto !== undefined && { monto: dto.monto }),
      },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');
    if (row.pedidoId != null) {
      await this.access.assertPedido(solicitanteId, row.pedidoId);
    }
    await this.prisma.factura.delete({ where: { id } });
    return { success: true, message: 'Factura eliminada' };
  }
}
