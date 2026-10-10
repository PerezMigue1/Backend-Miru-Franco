import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';

/** Leer cualquier factura (también las notas de mostrador sin pedido). */
const PERMISOS_LECTURA_CAJA = ['caja:lectura', 'caja:escritura'];
/** Registrar documentos fiscales, cambiarlos o borrarlos. */
const PERMISO_ESCRITURA_CAJA = 'caja:escritura';

@Injectable()
export class FacturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listarPorPedido(pedidoId: number, solicitanteId: string, propios = false) {
    await this.access.assertPedido(solicitanteId, pedidoId, propios);
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
    // La dueña del pedido ve su factura; todo lo demás (incluidas las notas sin pedido) es de caja.
    // Sin permiso se responde igual que si no existiera, para no revelar qué ids existen.
    const esDuena =
      row.pedidoId != null &&
      (await this.access.getPedidoUsuarioId(row.pedidoId)) === solicitanteId;
    if (!esDuena && !(await this.access.tienePermiso(solicitanteId, ...PERMISOS_LECTURA_CAJA))) {
      throw new NotFoundException('Factura no encontrada');
    }
    return { success: true, data: row };
  }

  async crear(solicitanteId: string, dto: CreateFacturaDto) {
    if (!(await this.access.tienePermiso(solicitanteId, PERMISO_ESCRITURA_CAJA))) {
      return this.crearSolicitud(solicitanteId, dto);
    }
    if (dto.pedidoId != null) {
      await this.access.getPedidoUsuarioId(dto.pedidoId);
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

  /**
   * Quien no maneja caja (la clienta) solo SOLICITA un CFDI de un pedido suyo: nace 'solicitada' y los
   * datos fiscales (folio, UUID, serie, PDF, XML) y el monto los captura caja al timbrarla.
   * Solo se guardan el RFC y la razón social que ella aporta.
   */
  private async crearSolicitud(solicitanteId: string, dto: CreateFacturaDto) {
    if (dto.tipo !== 'cfdi') {
      throw new ForbiddenException('Solo caja registra notas de venta');
    }
    if (dto.pedidoId == null) {
      throw new ForbiddenException('Para solicitar una factura indica uno de tus pedidos');
    }
    const { usuarioIdPedido } = await this.access.assertPedido(solicitanteId, dto.pedidoId);
    if (usuarioIdPedido !== solicitanteId) {
      throw new ForbiddenException('No tienes permiso para acceder a este recurso');
    }

    const data = await this.prisma.factura.create({
      data: {
        tipo: 'cfdi',
        pedidoId: dto.pedidoId,
        creadoPorId: solicitanteId,
        clienteNombre: null,
        concepto: null,
        monto: null,
        uuidFiscal: null,
        folio: null,
        serie: null,
        rfc: dto.rfc ?? null,
        razonSocial: dto.razonSocial ?? null,
        xmlUrl: null,
        pdfUrl: null,
        estado: 'solicitada',
      },
    });
    return { success: true, data };
  }

  /** Solo caja (caja:escritura). El controller ya lo exige con @Permisos; aquí se repite por si se llama desde otro lado. */
  private async assertEscrituraCaja(solicitanteId: string) {
    if (!(await this.access.tienePermiso(solicitanteId, PERMISO_ESCRITURA_CAJA))) {
      throw new ForbiddenException('No tienes permiso para acceder a este recurso');
    }
  }

  async actualizar(id: number, solicitanteId: string, dto: UpdateFacturaDto) {
    await this.assertEscrituraCaja(solicitanteId);
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');

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
    await this.assertEscrituraCaja(solicitanteId);
    const row = await this.prisma.factura.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Factura no encontrada');
    await this.prisma.factura.delete({ where: { id } });
    return { success: true, message: 'Factura eliminada' };
  }
}
