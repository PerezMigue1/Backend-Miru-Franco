import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { CreatePresentacionDto } from './dto/presentacion.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class ProductosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Elimina bytes nulos en cualquier string del payload (incluye objetos/arreglos anidados).
   * PostgreSQL rechaza \u0000 en columnas de texto.
   */
  private sanitizeNullBytesDeep<T>(value: T): T {
    if (typeof value === 'string') {
      return value.replace(/\u0000/g, '') as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeNullBytesDeep(item)) as T;
    }
    if (value instanceof Date) {
      return value;
    }
    if (Buffer.isBuffer(value)) {
      // Si el buffer contiene bytes nulos, conviértelo a string y elimina U+0000.
      // Esto evita el error de Postgres: invalid byte sequence for encoding "UTF8": 0x00
      // cuando un campo de texto termina recibiendo bytes.
      if (value.includes(0)) {
        const cleaned = value.toString('utf8').replace(/\u0000/g, '');
        return cleaned as unknown as T;
      }
      return value;
    }
    // Algunos parsers/transformadores pueden convertir campos binarios a Uint8Array.
    // Lo manejamos igual que Buffer para evitar que se cuele el byte 0x00.
    if (value instanceof Uint8Array) {
      if (value.includes(0)) {
        const cleaned = Buffer.from(value).toString('utf8').replace(/\u0000/g, '');
        return cleaned as unknown as T;
      }
      return value;
    }
    if (value && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        sanitized[key] = this.sanitizeNullBytesDeep(nested);
      }
      return sanitized as T;
    }
    return value;
  }

  /**
   * Encuentra rutas de campos string que aún contienen byte nulo.
   */
  private findNullBytePaths(value: unknown, basePath = 'root'): string[] {
    if (typeof value === 'string') {
      return value.includes('\u0000') ? [basePath] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        this.findNullBytePaths(item, `${basePath}[${index}]`),
      );
    }
    if (Buffer.isBuffer(value)) {
      // Si hay byte 0x00 dentro del buffer, reportarlo.
      return value.includes(0) ? [basePath] : [];
    }
    if (value instanceof Uint8Array) {
      return value.includes(0) ? [basePath] : [];
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(
        ([key, nested]) => this.findNullBytePaths(nested, `${basePath}.${key}`),
      );
    }
    return [];
  }

  /** Campos de presentación listos para Prisma (create/update). */
  private presentacionDataParaPrisma(p: CreatePresentacionDto) {
    return {
      tamanio: sanitizeInput(p.tamanio),
      imagenes: p.imagenes?.map((url) => sanitizeInput(url)) ?? [],
      precio: p.precio,
      precioOriginal: p.precioOriginal,
      stock: p.stock,
      disponible: p.disponible ?? true,
      fechaCaducidad: p.fechaCaducidad ? new Date(p.fechaCaducidad) : null,
    };
  }

  /**
   * Sincroniza presentaciones sin `deleteMany` masivo: `pedido_items` referencia `presentacion_id` con ON DELETE RESTRICT.
   */
  private async syncPresentacionesEnActualizacion(
    tx: Prisma.TransactionClient,
    productoId: number,
    items: CreatePresentacionDto[],
  ) {
    const existing = await tx.productoPresentacion.findMany({
      where: { productoId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));

    if (items.length === 0) {
      for (const { id: pid } of existing) {
        const n = await tx.pedidoItem.count({ where: { presentacionId: pid } });
        if (n > 0) {
          throw new BadRequestException(
            'No se pueden quitar todas las presentaciones: al menos una tiene ítems en pedidos.',
          );
        }
      }
      await tx.productoPresentacion.deleteMany({ where: { productoId } });
      return;
    }

    const hasAnyId = items.some((p) => p.id != null);
    if (!hasAnyId && existingIds.size > 0) {
      throw new BadRequestException(
        'Las presentaciones ya existentes deben incluir su id. Recarga el producto en el administrador.',
      );
    }

    for (const p of items) {
      if (p.id != null && !existingIds.has(p.id)) {
        throw new BadRequestException(
          `La presentación con id ${p.id} no pertenece a este producto.`,
        );
      }
    }

    const incomingIds = items.filter((p): p is CreatePresentacionDto & { id: number } => p.id != null).map((p) => p.id);
    const incomingIdSet = new Set(incomingIds);
    if (incomingIds.length !== incomingIdSet.size) {
      throw new BadRequestException('Hay ids de presentación duplicados en la solicitud.');
    }

    const toDelete = [...existingIds].filter((eid) => !incomingIdSet.has(eid));

    for (const delId of toDelete) {
      const n = await tx.pedidoItem.count({ where: { presentacionId: delId } });
      if (n > 0) {
        throw new BadRequestException(
          `No se puede eliminar la presentación (id ${delId}): consta en ${n} ítem(s) de pedidos. Desactívala (disponible) en lugar de borrarla.`,
        );
      }
    }

    for (const delId of toDelete) {
      await tx.productoPresentacion.delete({ where: { id: delId } });
    }

    for (const p of items) {
      const data = this.presentacionDataParaPrisma(p);
      if (p.id != null) {
        await tx.productoPresentacion.update({
          where: { id: p.id },
          data,
        });
      } else {
        await tx.productoPresentacion.create({
          data: { ...data, productoId },
        });
      }
    }
  }

  async listar(categoria?: string) {
    const where: any = {};

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

      // Devolvemos el detalle en el propio mensaje para poder verlo en el frontend
      throw new BadRequestException(
        `No se pudieron obtener los productos: ${(error as any)?.message || 'error desconocido'}`,
      );
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
    const modoUsoSanitizado = dto.modoUso ? sanitizeInput(dto.modoUso) : null;
    const resultadoSanitizado = dto.resultado ? sanitizeInput(dto.resultado) : null;

    // Prevenir SQL injection
    if (
      containsSQLInjection(nombreSanitizado) ||
      containsSQLInjection(marcaSanitizada) ||
      (descripcionSanitizada && containsSQLInjection(descripcionSanitizada)) ||
      (descripcionLargaSanitizada && containsSQLInjection(descripcionLargaSanitizada)) ||
      (categoriaSanitizada && containsSQLInjection(categoriaSanitizada)) ||
      (ingredientesSanitizados && containsSQLInjection(ingredientesSanitizados)) ||
      (modoUsoSanitizado && containsSQLInjection(modoUsoSanitizado)) ||
      (resultadoSanitizado && containsSQLInjection(resultadoSanitizado))
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
        descuento: dto.descuento,
        categoria: categoriaSanitizada,
        nuevo: dto.nuevo ?? false,
        crueltyFree: dto.crueltyFree ?? false,
        caracteristicas: caracteristicasSanitizadas,
        ingredientes: ingredientesSanitizados,
        modoUso: modoUsoSanitizado,
        resultado: resultadoSanitizado,
        presentaciones: presentaciones && presentaciones.length
          ? {
              create: presentaciones.map((p) => ({
                tamanio: sanitizeInput(p.tamanio),
                imagenes: p.imagenes?.map((url) => sanitizeInput(url)) ?? [],
                precio: p.precio,
                precioOriginal: p.precioOriginal,
                stock: p.stock,
                disponible: p.disponible ?? true,
                fechaCaducidad: p.fechaCaducidad ? new Date(p.fechaCaducidad) : undefined,
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
    dto = this.sanitizeNullBytesDeep(dto);

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

    if (dto.modoUso !== undefined) {
      dataActualizada.modoUso = dto.modoUso ? sanitizeInput(dto.modoUso) : null;
    }

    if (dto.resultado !== undefined) {
      dataActualizada.resultado = dto.resultado ? sanitizeInput(dto.resultado) : null;
    }

    if (dto.caracteristicas !== undefined) {
      dataActualizada.caracteristicas = dto.caracteristicas.map(c => sanitizeInput(c));
    }

    // Campos que no requieren sanitización especial
    if (dto.descuento !== undefined) dataActualizada.descuento = dto.descuento;
    if (dto.nuevo !== undefined) dataActualizada.nuevo = dto.nuevo;
    if (dto.crueltyFree !== undefined) dataActualizada.crueltyFree = dto.crueltyFree;

    const presentacionesInput = dto.presentaciones;

    const prismaData = { ...dataActualizada };
    const prismaDataSanitizada = this.sanitizeNullBytesDeep(prismaData);
    const paths = this.findNullBytePaths(prismaDataSanitizada);
    if (paths.length > 0) {
      throw new BadRequestException(
        `Caracteres inválidos detectados en: ${paths.join(', ')}`,
      );
    }

    let producto: any;
    try {
      producto = await this.prisma.$transaction(async (tx) => {
        await tx.producto.update({
          where: { id },
          data: prismaDataSanitizada,
        });
        if (presentacionesInput !== undefined) {
          await this.syncPresentacionesEnActualizacion(tx, id, presentacionesInput);
        }
        return tx.producto.findUnique({
          where: { id },
          include: { presentaciones: true },
        });
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = (error as any)?.message ? String((error as any).message) : String(error);
      // Evitar que el frontend vea /500 por un error de encoding conocido.
      if (message.includes('22021') || message.toLowerCase().includes('invalid byte sequence for encoding')) {
        const debugPaths = this.findNullBytePaths(prismaDataSanitizada);
        if (process.env.DEBUG_PRODUCTO_UPDATE === 'true') {
          console.error('[DEBUG_PRODUCTO_UPDATE] null byte paths finales:', debugPaths);
        }
        throw new BadRequestException('El formulario contiene caracteres inválidos (\\u0000). Revisa campos de texto antes de guardar.');
      }
      if (String(message).includes('Foreign key constraint') || (error as any)?.code === 'P2003') {
        throw new BadRequestException(
          'No se pudo actualizar las presentaciones: hay pedidos u otros datos que siguen usando una variante eliminada.',
        );
      }
      throw error;
    }

    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

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

    await this.prisma.producto.delete({
      where: { id },
    });

    console.log('✅ Producto eliminado:', sanitizeForLogging({ id }));

    return {
      success: true,
      message: 'Producto eliminado correctamente',
    };
  }
}

