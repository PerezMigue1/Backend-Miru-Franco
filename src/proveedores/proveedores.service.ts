import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProveedorDto } from './dto/create-proveedor.dto';
import { UpdateProveedorDto } from './dto/update-proveedor.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class ProveedoresService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const proveedores = await this.prisma.proveedor.findMany({
      where: { activo: true },
      orderBy: { id: 'asc' },
    });

    return {
      success: true,
      count: proveedores.length,
      data: proveedores,
    };
  }

  async obtenerPorId(id: number) {
    const proveedor = await this.prisma.proveedor.findUnique({ where: { id } });

    if (!proveedor || !proveedor.activo) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    return {
      success: true,
      data: proveedor,
    };
  }

  async crear(dto: CreateProveedorDto) {
    const nombreSanitizado = sanitizeInput(dto.nombre);
    const contactoSanitizado = dto.contacto ? sanitizeInput(dto.contacto) : null;
    const productosSanitizados = dto.productos ? sanitizeInput(dto.productos) : null;
    const direccionSanitizada = dto.direccion ? sanitizeInput(dto.direccion) : null;

    if (
      containsSQLInjection(nombreSanitizado) ||
      (contactoSanitizado && containsSQLInjection(contactoSanitizado)) ||
      (productosSanitizados && containsSQLInjection(productosSanitizados)) ||
      (direccionSanitizada && containsSQLInjection(direccionSanitizada))
    ) {
      console.warn('⚠️ Intento de SQL injection detectado en crear proveedor:', sanitizeForLogging({ nombre: nombreSanitizado }));
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    const proveedor = await this.prisma.proveedor.create({
      data: {
        nombre: nombreSanitizado,
        contacto: contactoSanitizado,
        productos: productosSanitizados,
        direccion: direccionSanitizada,
      },
    });

    console.log('✅ Proveedor creado:', sanitizeForLogging({ id: proveedor.id, nombre: proveedor.nombre }));

    return {
      success: true,
      message: 'Proveedor creado correctamente',
      data: proveedor,
    };
  }

  async actualizar(id: number, dto: UpdateProveedorDto) {
    const existe = await this.prisma.proveedor.findUnique({ where: { id } });
    if (!existe || !existe.activo) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    const dataActualizada: Record<string, unknown> = {};

    if (dto.nombre !== undefined) {
      const nombreSanitizado = sanitizeInput(dto.nombre);
      if (containsSQLInjection(nombreSanitizado)) {
        throw new BadRequestException('Nombre inválido');
      }
      dataActualizada.nombre = nombreSanitizado;
    }

    if (dto.contacto !== undefined) {
      dataActualizada.contacto = dto.contacto ? sanitizeInput(dto.contacto) : null;
    }

    if (dto.productos !== undefined) {
      dataActualizada.productos = dto.productos ? sanitizeInput(dto.productos) : null;
    }

    if (dto.direccion !== undefined) {
      dataActualizada.direccion = dto.direccion ? sanitizeInput(dto.direccion) : null;
    }

    const proveedor = await this.prisma.proveedor.update({
      where: { id },
      data: dataActualizada,
    });

    console.log('✅ Proveedor actualizado:', sanitizeForLogging({ id: proveedor.id, nombre: proveedor.nombre }));

    return {
      success: true,
      message: 'Proveedor actualizado correctamente',
      data: proveedor,
    };
  }

  /** Borrado lógico: marca activo=false, no borra la fila (consistente con futuras referencias desde compras). */
  async eliminar(id: number) {
    const existe = await this.prisma.proveedor.findUnique({ where: { id } });
    if (!existe || !existe.activo) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    await this.prisma.proveedor.update({
      where: { id },
      data: { activo: false },
    });

    console.log('✅ Proveedor eliminado (lógico):', sanitizeForLogging({ id }));

    return {
      success: true,
      message: 'Proveedor eliminado correctamente',
    };
  }
}
