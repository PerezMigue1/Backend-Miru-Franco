import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class ProductosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(categoria?: string) {
    const where: any = { disponible: true };

    if (categoria) {
      // Sanitizar categoría antes de usar
      const categoriaSanitizada = sanitizeInput(categoria);
      if (containsSQLInjection(categoriaSanitizada)) {
        console.warn(
          '⚠️ Intento de SQL injection detectado en listar productos:',
          sanitizeForLogging({ categoria }),
        );
        throw new BadRequestException('Categoría inválida');
      }
      where.categoria = categoriaSanitizada;
    }

    try {
      const productos = await this.prisma.producto.findMany({
        where,
        include: { presentaciones: true },
        orderBy: { id: 'asc' },
      });

      return {
        success: true,
        count: productos.length,
        data: productos,
      };
    } catch (error) {
      // Log detallado para depuración
      console.error('❌ Error al listar productos:', error);

      // En desarrollo exponemos el mensaje real para poder ver el problema
      if (process.env.NODE_ENV !== 'production') {
        throw new BadRequestException(
          `Error al listar productos: ${(error as any)?.message || 'error desconocido'}`,
        );
      }

      // En producción devolvemos mensaje genérico
      throw new BadRequestException('No se pudieron obtener los productos');
    }
  }

  async obtenerPorId(id: number) {
    const producto = await this.prisma.producto.findUnique({
      where: { id },
      include: { presentaciones: true },
    });

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    return {
      success: true,
      data: producto,
    };
  }

  async crear(dto: CreateProductoDto) {
    // Sanitizar datos de entrada
    const nombreSanitizado = sanitizeInput(dto.nombre);
    const marcaSanitizada = sanitizeInput(dto.marca);
    const descripcionSanitizada = dto.descripcion ? sanitizeInput(dto.descripcion) : null;
    const descripcionLargaSanitizada = dto.descripcionLarga ? sanitizeInput(dto.descripcionLarga) : null;
    const categoriaSanitizada = dto.categoria ? sanitizeInput(dto.categoria) : null;
    const ingredientesSanitizados = dto.ingredientes ? sanitizeInput(dto.ingredientes) : null;

    // Prevenir SQL injection
    if (
      containsSQLInjection(nombreSanitizado) ||
      containsSQLInjection(marcaSanitizada) ||
      (descripcionSanitizada && containsSQLInjection(descripcionSanitizada)) ||
      (descripcionLargaSanitizada && containsSQLInjection(descripcionLargaSanitizada)) ||
      (categoriaSanitizada && containsSQLInjection(categoriaSanitizada)) ||
      (ingredientesSanitizados && containsSQLInjection(ingredientesSanitizados))
    ) {
      console.warn('⚠️ Intento de SQL injection detectado en crear producto:', sanitizeForLogging({ nombre: nombreSanitizado }));
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    // Sanitizar características si vienen
    const caracteristicasSanitizadas = dto.caracteristicas
      ? dto.caracteristicas.map(c => sanitizeInput(c))
      : [];

    const { presentaciones, ...dataProducto } = dto;

    const producto = await this.prisma.producto.create({
      data: {
        nombre: nombreSanitizado,
        marca: marcaSanitizada,
        descripcion: descripcionSanitizada,
        descripcionLarga: descripcionLargaSanitizada,
        precio: dto.precio,
        precioOriginal: dto.precioOriginal,
        descuento: dto.descuento,
        categoria: categoriaSanitizada,
        stock: dto.stock,
        disponible: dto.disponible ?? true,
        nuevo: dto.nuevo ?? false,
        crueltyFree: dto.crueltyFree ?? false,
        caracteristicas: caracteristicasSanitizadas,
        ingredientes: ingredientesSanitizados,
        presentaciones: presentaciones && presentaciones.length
          ? {
              create: presentaciones.map((p) => ({
                tamanio: sanitizeInput(p.tamanio),
                precio: p.precio,
                precioOriginal: p.precioOriginal,
                stock: p.stock,
                disponible: p.disponible ?? true,
              })),
            }
          : undefined,
      },
      include: { presentaciones: true },
    });

    console.log('✅ Producto creado:', sanitizeForLogging({ id: producto.id, nombre: producto.nombre }));

    return {
      success: true,
      message: 'Producto creado correctamente',
      data: producto,
    };
  }

  async actualizar(id: number, dto: UpdateProductoDto) {
    const existe = await this.prisma.producto.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Producto no encontrado');
    }

    // Sanitizar datos de entrada
    const dataActualizada: any = {};

    if (dto.nombre !== undefined) {
      const nombreSanitizado = sanitizeInput(dto.nombre);
      if (containsSQLInjection(nombreSanitizado)) {
        throw new BadRequestException('Nombre inválido');
      }
      dataActualizada.nombre = nombreSanitizado;
    }

    if (dto.marca !== undefined) {
      const marcaSanitizada = sanitizeInput(dto.marca);
      if (containsSQLInjection(marcaSanitizada)) {
        throw new BadRequestException('Marca inválida');
      }
      dataActualizada.marca = marcaSanitizada;
    }

    if (dto.descripcion !== undefined) {
      dataActualizada.descripcion = dto.descripcion ? sanitizeInput(dto.descripcion) : null;
    }

    if (dto.descripcionLarga !== undefined) {
      dataActualizada.descripcionLarga = dto.descripcionLarga ? sanitizeInput(dto.descripcionLarga) : null;
    }

    if (dto.categoria !== undefined) {
      dataActualizada.categoria = dto.categoria ? sanitizeInput(dto.categoria) : null;
    }

    if (dto.ingredientes !== undefined) {
      dataActualizada.ingredientes = dto.ingredientes ? sanitizeInput(dto.ingredientes) : null;
    }

    if (dto.caracteristicas !== undefined) {
      dataActualizada.caracteristicas = dto.caracteristicas.map(c => sanitizeInput(c));
    }

    // Campos que no requieren sanitización especial
    if (dto.precio !== undefined) dataActualizada.precio = dto.precio;
    if (dto.precioOriginal !== undefined) dataActualizada.precioOriginal = dto.precioOriginal;
    if (dto.descuento !== undefined) dataActualizada.descuento = dto.descuento;
    if (dto.stock !== undefined) dataActualizada.stock = dto.stock;
    if (dto.disponible !== undefined) dataActualizada.disponible = dto.disponible;
    if (dto.nuevo !== undefined) dataActualizada.nuevo = dto.nuevo;
    if (dto.crueltyFree !== undefined) dataActualizada.crueltyFree = dto.crueltyFree;

    // Manejar presentaciones
    if (dto.presentaciones) {
      dataActualizada.presentaciones = {
        deleteMany: {}, // borra todas las previas
        create: dto.presentaciones.map((p) => ({
          tamanio: sanitizeInput(p.tamanio),
          precio: p.precio,
          precioOriginal: p.precioOriginal,
          stock: p.stock,
          disponible: p.disponible ?? true,
        })),
      };
    }

    const producto = await this.prisma.producto.update({
      where: { id },
      data: dataActualizada,
      include: { presentaciones: true },
    });

    console.log('✅ Producto actualizado:', sanitizeForLogging({ id: producto.id, nombre: producto.nombre }));

    return {
      success: true,
      message: 'Producto actualizado correctamente',
      data: producto,
    };
  }

  async eliminar(id: number) {
    const existe = await this.prisma.producto.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Producto no encontrado');
    }

    await this.prisma.producto.update({
      where: { id },
      data: { disponible: false },
    });

    console.log('✅ Producto deshabilitado:', sanitizeForLogging({ id }));

    return {
      success: true,
      message: 'Producto deshabilitado correctamente',
    };
  }
}

