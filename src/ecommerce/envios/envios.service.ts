import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { CreateEnvioDto } from './dto/create-envio.dto';
import { UpdateEnvioDto } from './dto/update-envio.dto';

@Injectable()
export class EnviosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  async listarPorPedido(pedidoId: number, solicitanteId: string) {
    await this.access.assertPedido(solicitanteId, pedidoId);
    const data = await this.prisma.envio.findMany({
      where: { pedidoId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: number, solicitanteId: string) {
    const row = await this.prisma.envio.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Envío no encontrado');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    return { success: true, data: row };
  }

  async crear(solicitanteId: string, dto: CreateEnvioDto) {
    await this.access.assertPedido(solicitanteId, dto.pedidoId);
    const data = await this.prisma.envio.create({
      data: {
        pedidoId: dto.pedidoId,
        empresaEnvio: dto.empresaEnvio ?? null,
        numeroGuia: dto.numeroGuia ?? null,
        ...(dto.estadoEnvio !== undefined && { estadoEnvio: dto.estadoEnvio }),
        fechaEnvio: dto.fechaEnvio ? new Date(dto.fechaEnvio) : null,
        fechaEntrega: dto.fechaEntrega ? new Date(dto.fechaEntrega) : null,
        notas: dto.notas ?? null,
      },
    });
    return { success: true, data };
  }

  async actualizar(id: number, solicitanteId: string, dto: UpdateEnvioDto) {
    const row = await this.prisma.envio.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Envío no encontrado');
    await this.access.assertPedido(solicitanteId, row.pedidoId);

    const data = await this.prisma.envio.update({
      where: { id },
      data: {
        ...(dto.empresaEnvio !== undefined && {
          empresaEnvio: dto.empresaEnvio,
        }),
        ...(dto.numeroGuia !== undefined && { numeroGuia: dto.numeroGuia }),
        ...(dto.estadoEnvio !== undefined && { estadoEnvio: dto.estadoEnvio }),
        ...(dto.fechaEnvio !== undefined && {
          fechaEnvio: dto.fechaEnvio ? new Date(dto.fechaEnvio) : null,
        }),
        ...(dto.fechaEntrega !== undefined && {
          fechaEntrega: dto.fechaEntrega ? new Date(dto.fechaEntrega) : null,
        }),
        ...(dto.notas !== undefined && { notas: dto.notas }),
      },
    });
    return { success: true, data };
  }

  async eliminar(id: number, solicitanteId: string) {
    const row = await this.prisma.envio.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Envío no encontrado');
    await this.access.assertPedido(solicitanteId, row.pedidoId);
    await this.prisma.envio.delete({ where: { id } });
    return { success: true, message: 'Envío eliminado' };
  }
}
