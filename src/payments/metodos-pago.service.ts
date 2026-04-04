import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EcommerceAccessService } from '../ecommerce/common/ecommerce-access.service';
import { sanitizeInput } from '../common/utils/security.util';
import { CreateMetodoPagoDto } from './dto/create-metodo-pago.dto';
import { UpdateMetodoPagoDto } from './dto/update-metodo-pago.dto';

const selectMetodo = {
  id: true,
  proveedor: true,
  idExterno: true,
  marca: true,
  ultimos4: true,
  bancoNombre: true,
  expMes: true,
  expAnio: true,
  tipoTarjeta: true,
  esVirtual: true,
  etiqueta: true,
  esPredeterminada: true,
  activo: true,
  creadoEn: true,
  actualizadoEn: true,
  usuarioId: true,
} as const;

@Injectable()
export class MetodosPagoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  /**
   * Lista métodos activos del usuario autenticado.
   * Admin puede pasar `usuarioId` en query para ver los de otro usuario.
   */
  async listar(solicitanteId: string, filtroUsuarioId?: string) {
    const rol = await this.access.getRol(solicitanteId);
    let targetUserId = solicitanteId;
    if (filtroUsuarioId) {
      if (!this.access.isAdmin(rol)) {
        throw new ForbiddenException(
          'Solo administradores pueden listar métodos de pago de otro usuario',
        );
      }
      targetUserId = filtroUsuarioId;
    }

    const data = await this.prisma.metodoPagoUsuario.findMany({
      where: { usuarioId: targetUserId, activo: true },
      select: selectMetodo,
      orderBy: [{ esPredeterminada: 'desc' }, { creadoEn: 'desc' }],
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: string, solicitanteId: string) {
    await this.assertMetodoPago(solicitanteId, id);
    const data = await this.prisma.metodoPagoUsuario.findFirst({
      where: { id, activo: true },
      select: selectMetodo,
    });
    if (!data) throw new NotFoundException('Método de pago no encontrado');
    return { success: true, data };
  }

  async crear(solicitanteId: string, dto: CreateMetodoPagoDto) {
    const usuarioId = solicitanteId;
    const proveedor = sanitizeInput(dto.proveedor);
    const idExterno = sanitizeInput(dto.idExterno).replace(/\s/g, '');
    const marca = dto.marca != null ? sanitizeInput(dto.marca) : null;
    const bancoNombre =
      dto.bancoNombre != null ? sanitizeInput(dto.bancoNombre) : null;
    const etiqueta = dto.etiqueta != null ? sanitizeInput(dto.etiqueta) : null;

    if (!proveedor || !idExterno) {
      throw new ConflictException('proveedor e idExterno son requeridos');
    }

    const existente = await this.prisma.metodoPagoUsuario.findUnique({
      where: {
        usuarioId_proveedor_idExterno: {
          usuarioId,
          proveedor,
          idExterno,
        },
      },
    });

    if (existente) {
      if (!existente.activo) {
        const data = await this.prisma.metodoPagoUsuario.update({
          where: { id: existente.id },
          data: {
            activo: true,
            ultimos4: dto.ultimos4,
            marca,
            bancoNombre,
            expMes: dto.expMes ?? null,
            expAnio: dto.expAnio ?? null,
            tipoTarjeta: dto.tipoTarjeta ?? null,
            esVirtual: dto.esVirtual ?? false,
            etiqueta,
            esPredeterminada: dto.esPredeterminada ?? false,
          },
          select: selectMetodo,
        });
        if (dto.esPredeterminada) {
          await this.quitarOtrasPredeterminadas(usuarioId, data.id);
        }
        return { success: true, message: 'Método reactivado', data };
      }
      throw new ConflictException('Esta tarjeta ya está guardada');
    }

    if (dto.esPredeterminada) {
      await this.prisma.metodoPagoUsuario.updateMany({
        where: { usuarioId },
        data: { esPredeterminada: false },
      });
    }

    const data = await this.prisma.metodoPagoUsuario.create({
      data: {
        usuarioId,
        proveedor,
        idExterno,
        ultimos4: dto.ultimos4,
        marca,
        bancoNombre,
        expMes: dto.expMes ?? null,
        expAnio: dto.expAnio ?? null,
        tipoTarjeta: dto.tipoTarjeta ?? null,
        esVirtual: dto.esVirtual ?? false,
        etiqueta,
        esPredeterminada: dto.esPredeterminada ?? false,
      },
      select: selectMetodo,
    });

    return { success: true, data };
  }

  async actualizar(
    id: string,
    solicitanteId: string,
    dto: UpdateMetodoPagoDto,
  ) {
    await this.assertMetodoPago(solicitanteId, id);
    const actual = await this.prisma.metodoPagoUsuario.findFirst({
      where: { id, activo: true },
    });
    if (!actual) throw new NotFoundException('Método de pago no encontrado');

    if (dto.esPredeterminada === true) {
      await this.prisma.metodoPagoUsuario.updateMany({
        where: { usuarioId: actual.usuarioId, id: { not: id } },
        data: { esPredeterminada: false },
      });
    }

    const data = await this.prisma.metodoPagoUsuario.update({
      where: { id },
      data: {
        ...(dto.esPredeterminada !== undefined && {
          esPredeterminada: dto.esPredeterminada,
        }),
        ...(dto.etiqueta !== undefined && {
          etiqueta: dto.etiqueta ? sanitizeInput(dto.etiqueta) : null,
        }),
      },
      select: selectMetodo,
    });

    return { success: true, data };
  }

  /** Baja lógica (activo = false). */
  async eliminar(id: string, solicitanteId: string) {
    await this.assertMetodoPago(solicitanteId, id);
    const actual = await this.prisma.metodoPagoUsuario.findUnique({
      where: { id },
    });
    if (!actual) throw new NotFoundException('Método de pago no encontrado');

    await this.prisma.metodoPagoUsuario.update({
      where: { id },
      data: { activo: false, esPredeterminada: false },
    });

    return { success: true, message: 'Método de pago eliminado' };
  }

  private async quitarOtrasPredeterminadas(
    usuarioId: string,
    exceptId: string,
  ) {
    await this.prisma.metodoPagoUsuario.updateMany({
      where: { usuarioId, id: { not: exceptId }, activo: true },
      data: { esPredeterminada: false },
    });
  }

  private async assertMetodoPago(
    solicitanteId: string,
    metodoId: string,
  ): Promise<void> {
    const rol = await this.access.getRol(solicitanteId);
    const row = await this.prisma.metodoPagoUsuario.findUnique({
      where: { id: metodoId },
      select: { usuarioId: true },
    });
    if (!row) throw new NotFoundException('Método de pago no encontrado');
    this.access.assertOwnerOrAdmin(solicitanteId, row.usuarioId, rol);
  }
}
