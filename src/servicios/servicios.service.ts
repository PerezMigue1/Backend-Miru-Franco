import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class ServiciosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(categoria?: string) {
    const where: any = { activo: true };

    if (categoria) {
      const categoriaSanitizada = sanitizeInput(categoria);
      if (containsSQLInjection(categoriaSanitizada)) {
        console.warn(
          '⚠️ Intento de SQL injection detectado en listar servicios:',
          sanitizeForLogging({ categoria }),
        );
        throw new BadRequestException('Categoría inválida');
      }
      where.categoria = categoriaSanitizada;
    }

    try {
      const servicios = await this.prisma.servicio.findMany({
        where,
        include: {
          productosAsociados: {
            include: { producto: true },
          },
          especialistas: {
            include: {
              usuario: {
                select: { id: true, nombre: true, email: true },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
      });

      return {
        success: true,
        count: servicios.length,
        data: servicios,
      };
    } catch (error) {
      // Evitar duplicar stacks gigantes: HttpExceptionFilter ya registra el error global
      throw new BadRequestException(
        `No se pudieron obtener los servicios: ${(error as any)?.message || 'error desconocido'}`,
      );
    }
  }

  async obtenerPorId(id: number) {
    const servicio = await this.prisma.servicio.findUnique({
      where: { id },
      include: {
        productosAsociados: {
          include: { producto: true },
        },
      },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    return {
      success: true,
      data: servicio,
    };
  }

  async crear(dto: CreateServicioDto) {
    const nombreSanitizado = sanitizeInput(dto.nombre);
    const categoriaSanitizada = sanitizeInput(dto.categoria);
    const descripcionSanitizada = dto.descripcion ? sanitizeInput(dto.descripcion) : null;
    const descripcionLargaSanitizada = dto.descripcionLarga ? sanitizeInput(dto.descripcionLarga) : null;

    if (
      containsSQLInjection(nombreSanitizado) ||
      containsSQLInjection(categoriaSanitizada) ||
      (descripcionSanitizada && containsSQLInjection(descripcionSanitizada)) ||
      (descripcionLargaSanitizada && containsSQLInjection(descripcionLargaSanitizada))
    ) {
      console.warn('⚠️ Intento de SQL injection detectado en crear servicio:', sanitizeForLogging({ nombre: nombreSanitizado }));
      throw new BadRequestException('Datos inválidos.');
    }

    const imagen = Array.isArray(dto.imagen) ? dto.imagen : [];
    const incluye = Array.isArray(dto.incluye) ? dto.incluye : [];
    const recomendaciones = Array.isArray(dto.recomendaciones) ? dto.recomendaciones : [];

    const servicio = await this.prisma.servicio.create({
      data: {
        nombre: nombreSanitizado,
        descripcion: descripcionSanitizada,
        descripcionLarga: descripcionLargaSanitizada,
        precio: dto.precio,
        duracionMinutos: dto.duracionMinutos,
        categoria: categoriaSanitizada,
        requiereEvaluacion: dto.requiereEvaluacion ?? false,
        imagen,
        incluye,
        recomendaciones,
        activo: dto.activo ?? true,
        productosAsociados:
          dto.productosAsociados && dto.productosAsociados.length > 0
            ? {
                create: dto.productosAsociados.map((p) => ({
                  productoId: p.productoId,
                  cantidadEstimada: p.cantidadEstimada ?? 1,
                })),
              }
            : undefined,
        especialistas:
          dto.especialistas && dto.especialistas.length > 0
            ? {
                create: dto.especialistas.map((e) => ({ usuarioId: e.usuarioId })),
              }
            : undefined,
      },
      include: {
        productosAsociados: { include: { producto: true } },
        especialistas: {
          include: { usuario: { select: { id: true, nombre: true, email: true } } },
        },
      },
    });

    return {
      success: true,
      message: 'Servicio creado correctamente',
      data: servicio,
    };
  }

  async actualizar(id: number, dto: UpdateServicioDto) {
    const existe = await this.prisma.servicio.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Servicio no encontrado');
    }

    const data: any = {};

    if (dto.nombre !== undefined) {
      const v = sanitizeInput(dto.nombre);
      if (containsSQLInjection(v)) throw new BadRequestException('Nombre inválido');
      data.nombre = v;
    }
    if (dto.descripcion !== undefined) data.descripcion = dto.descripcion ? sanitizeInput(dto.descripcion) : null;
    if (dto.descripcionLarga !== undefined) data.descripcionLarga = dto.descripcionLarga ? sanitizeInput(dto.descripcionLarga) : null;
    if (dto.precio !== undefined) data.precio = dto.precio;
    if (dto.duracionMinutos !== undefined) data.duracionMinutos = dto.duracionMinutos;
    if (dto.categoria !== undefined) {
      const v = sanitizeInput(dto.categoria);
      if (containsSQLInjection(v)) throw new BadRequestException('Categoría inválida');
      data.categoria = v;
    }
    if (dto.requiereEvaluacion !== undefined) data.requiereEvaluacion = dto.requiereEvaluacion;
    if (dto.imagen !== undefined) data.imagen = dto.imagen;
    if (dto.incluye !== undefined) data.incluye = dto.incluye;
    if (dto.recomendaciones !== undefined) data.recomendaciones = dto.recomendaciones;
    if (dto.activo !== undefined) data.activo = dto.activo;

    if (dto.productosAsociados !== undefined) {
      data.productosAsociados = {
        deleteMany: {},
        create:
          dto.productosAsociados.length > 0
            ? dto.productosAsociados.map((p) => ({
                productoId: p.productoId,
                cantidadEstimada: p.cantidadEstimada ?? 1,
              }))
            : [],
      };
    }

    if (dto.especialistas !== undefined) {
      data.especialistas = {
        deleteMany: {},
        create: dto.especialistas.map((e) => ({ usuarioId: e.usuarioId })),
      };
    }

    const servicio = await this.prisma.servicio.update({
      where: { id },
      data,
      include: {
        productosAsociados: { include: { producto: true } },
        especialistas: {
          include: { usuario: { select: { id: true, nombre: true, email: true } } },
        },
      },
    });

    return {
      success: true,
      message: 'Servicio actualizado correctamente',
      data: servicio,
    };
  }

  async eliminar(id: number) {
    const existe = await this.prisma.servicio.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException('Servicio no encontrado');
    }

    await this.prisma.servicio.update({
      where: { id },
      data: { activo: false },
    });

    return {
      success: true,
      message: 'Servicio deshabilitado correctamente',
    };
  }
}
