import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class CotizacionesService {
  constructor(private readonly prisma: PrismaService) {}

  private incluirRelaciones() {
    return {
      paquete: { select: { id: true, tipo_evento: true, descripcion: true, precio_especial: true } },
      cliente: { select: { id: true, nombre: true, email: true, telefono: true } },
    } as const;
  }

  async listar() {
    const cotizaciones = await this.prisma.cotizacion.findMany({
      include: this.incluirRelaciones(),
      orderBy: { fechaEvento: 'asc' },
    });

    return {
      success: true,
      count: cotizaciones.length,
      data: cotizaciones,
    };
  }

  async obtenerPorId(id: number) {
    const cotizacion = await this.prisma.cotizacion.findUnique({
      where: { id },
      include: this.incluirRelaciones(),
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotización no encontrada');
    }

    return {
      success: true,
      data: cotizacion,
    };
  }

  async crear(dto: CreateCotizacionDto) {
    const clienteNombreSanitizado = sanitizeInput(dto.clienteNombre);
    const notasSanitizadas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (
      containsSQLInjection(clienteNombreSanitizado) ||
      (notasSanitizadas && containsSQLInjection(notasSanitizadas))
    ) {
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    const paquete = await this.prisma.paquete.findUnique({ where: { id: dto.paqueteId } });
    if (!paquete) {
      throw new NotFoundException('Paquete no encontrado');
    }

    const anticipo = dto.anticipo ?? 0;
    if (anticipo > dto.monto) {
      throw new BadRequestException('El anticipo no puede ser mayor al monto total');
    }

    if (dto.clienteId) {
      const cliente = await this.prisma.usuario.findUnique({ where: { id: dto.clienteId } });
      if (!cliente) {
        throw new NotFoundException('Cliente no encontrado');
      }
    }

    const cotizacion = await this.prisma.cotizacion.create({
      data: {
        clienteNombre: clienteNombreSanitizado,
        clienteId: dto.clienteId ?? null,
        paqueteId: dto.paqueteId,
        fechaEvento: new Date(dto.fechaEvento),
        cantidadPersonas: dto.cantidadPersonas ?? null,
        monto: dto.monto,
        anticipo,
        notas: notasSanitizadas,
      },
      include: this.incluirRelaciones(),
    });

    console.log('✅ Cotización creada:', sanitizeForLogging({ id: cotizacion.id, cliente: clienteNombreSanitizado }));

    return {
      success: true,
      message: 'Cotización creada correctamente',
      data: cotizacion,
    };
  }

  async actualizar(id: number, dto: UpdateCotizacionDto) {
    const existe = await this.prisma.cotizacion.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Cotización no encontrada');
    }

    const dataActualizada: Record<string, unknown> = {};

    if (dto.clienteNombre !== undefined) {
      const clienteNombreSanitizado = sanitizeInput(dto.clienteNombre);
      if (containsSQLInjection(clienteNombreSanitizado)) {
        throw new BadRequestException('Nombre de cliente inválido');
      }
      dataActualizada.clienteNombre = clienteNombreSanitizado;
    }

    if (dto.clienteId !== undefined) {
      if (dto.clienteId) {
        const cliente = await this.prisma.usuario.findUnique({ where: { id: dto.clienteId } });
        if (!cliente) {
          throw new NotFoundException('Cliente no encontrado');
        }
      }
      dataActualizada.clienteId = dto.clienteId || null;
    }

    if (dto.paqueteId !== undefined) {
      const paquete = await this.prisma.paquete.findUnique({ where: { id: dto.paqueteId } });
      if (!paquete) {
        throw new NotFoundException('Paquete no encontrado');
      }
      dataActualizada.paqueteId = dto.paqueteId;
    }

    if (dto.fechaEvento !== undefined) dataActualizada.fechaEvento = new Date(dto.fechaEvento);
    if (dto.cantidadPersonas !== undefined) dataActualizada.cantidadPersonas = dto.cantidadPersonas;
    if (dto.notas !== undefined) dataActualizada.notas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (dto.estado !== undefined) dataActualizada.estado = dto.estado;

    const montoFinal = dto.monto ?? Number(existe.monto);
    const anticipoFinal = dto.anticipo ?? Number(existe.anticipo);
    if (anticipoFinal > montoFinal) {
      throw new BadRequestException('El anticipo no puede ser mayor al monto total');
    }
    if (dto.monto !== undefined) dataActualizada.monto = dto.monto;
    if (dto.anticipo !== undefined) dataActualizada.anticipo = dto.anticipo;

    const cotizacion = await this.prisma.cotizacion.update({
      where: { id },
      data: dataActualizada,
      include: this.incluirRelaciones(),
    });

    console.log('✅ Cotización actualizada:', sanitizeForLogging({ id: cotizacion.id, estado: cotizacion.estado }));

    return {
      success: true,
      message: 'Cotización actualizada correctamente',
      data: cotizacion,
    };
  }
}
