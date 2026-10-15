import { Injectable, NotFoundException, BadRequestException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';
import { anticipoAplica } from '../citas/anticipos/anticipos.util';
import { ImagenesSubidasService } from '../subidas/imagenes-subidas.service';

/** URLs guardadas en servicios.imagen (JSON): solo los textos. */
const imagenesGuardadas = (valor: unknown): string[] => (Array.isArray(valor) ? valor.filter((u): u is string => typeof u === 'string') : []);

/**
 * `anticipoAplica`: si hoy se pide anticipo al agendar este servicio en línea (misma regla que la creación de
 * la cita: monto y ANTICIPOS_DESDE). La web lo usa para anunciar el anticipo; `anticipoMonto` no cambia.
 */
const conAnticipoAplica = <T extends { anticipoMonto?: unknown }>(servicio: T) => ({ ...servicio, anticipoAplica: anticipoAplica(servicio) });

@Injectable()
export class ServiciosService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly subidas?: ImagenesSubidasService,
  ) {}

  /** Imágenes del formulario: solo las que ya tenía o subidas propias (nunca una URL escrita a mano). */
  private imagenes(): ImagenesSubidasService {
    if (!this.subidas) throw new ServiceUnavailableException('La subida de imágenes no está disponible por ahora.');
    return this.subidas;
  }

  /**
   * @param incluirInactivos Solo debe ser true desde la ruta admin protegida
   * (GET /api/servicios/admin). La ruta pública NUNCA lo pasa como true.
   */
  async listar(categoria?: string, incluirInactivos = false) {
    const where: any = incluirInactivos ? {} : { activo: true };

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

    const servicios = await this.prisma.servicio.findMany({
      where,
      include: {
        productosAsociados: {
          include: { producto: true },
        },
        especialistas: {
          include: {
            usuario: {
              select: { id: true, nombre: true },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return {
      success: true,
      count: servicios.length,
      data: servicios.map(conAnticipoAplica),
    };

  }

  /** Un inactivo solo lo ve el personal que administra servicios (panel de edición); al resto le responde 404. */
  async obtenerPorId(id: number, usuarioId?: string) {
    const servicio = await this.prisma.servicio.findUnique({
      where: { id },
      include: {
        productosAsociados: {
          include: { producto: true },
        },
      },
    });

    if (!servicio || (!servicio.activo && !(await this.puedeVerInactivos(usuarioId)))) {
      throw new NotFoundException('Servicio no encontrado');
    }

    return {
      success: true,
      data: conAnticipoAplica(servicio),
    };
  }

  /** Claves del rol (permisos_rol): '*' o servicios:lectura/escritura, igual que GET /servicios/admin. */
  private async puedeVerInactivos(usuarioId?: string): Promise<boolean> {
    if (!usuarioId) return false;
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { rol: true } });
    if (!usuario) return false;
    const permisoRol = await this.prisma.permisoRol.findUnique({ where: { rol: usuario.rol }, select: { claves: true } });
    const claves = permisoRol?.claves ?? [];
    return ['*', 'servicios:lectura', 'servicios:escritura'].some((c) => claves.includes(c));
  }

  async crear(dto: CreateServicioDto, usuarioId?: string) {
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

    // Imágenes nuevas: solo subidas propias de servicios/ (el botón "Subir foto"); una URL escrita a mano es 400.
    const imagen = Array.isArray(dto.imagen) && dto.imagen.length ? await this.imagenes().resolverImagenes(usuarioId ?? '', 'servicios', dto.imagen) : [];
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
          include: { usuario: { select: { id: true, nombre: true } } },
        },
      },
    });

    return {
      success: true,
      message: 'Servicio creado correctamente',
      data: servicio,
    };
  }

  async actualizar(id: number, dto: UpdateServicioDto, usuarioId?: string) {
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
    if (dto.precio !== undefined) {
      // Las citas guardan el anticipo: un precio menor dejaría citas que el POS no puede cobrar.
      if (existe.anticipoMonto && Math.round(dto.precio * 100) < Math.round(Number(existe.anticipoMonto) * 100)) {
        throw new BadRequestException('El precio no puede ser menor que el anticipo del servicio; ajusta primero el anticipo');
      }
      data.precio = dto.precio;
    }
    if (dto.duracionMinutos !== undefined) data.duracionMinutos = dto.duracionMinutos;
    if (dto.categoria !== undefined) {
      const v = sanitizeInput(dto.categoria);
      if (containsSQLInjection(v)) throw new BadRequestException('Categoría inválida');
      data.categoria = v;
    }
    if (dto.requiereEvaluacion !== undefined) data.requiereEvaluacion = dto.requiereEvaluacion;
    // Las imágenes que ya tenía se conservan igual; las nuevas solo como subidas propias de servicios/.
    if (dto.imagen !== undefined) {
      const actuales = imagenesGuardadas(existe.imagen);
      const pedidas = Array.isArray(dto.imagen) ? dto.imagen : [];
      data.imagen = pedidas.every((u) => actuales.includes(u))
        ? pedidas
        : await this.imagenes().resolverImagenes(usuarioId ?? '', 'servicios', pedidas, actuales);
    }
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
          include: { usuario: { select: { id: true, nombre: true } } },
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

  /** Anticipo que se pide al agendar en línea. 0 o nulo: el servicio no pide anticipo. No puede pasar del precio. */
  async actualizarAnticipo(id: number, anticipoMonto: number | null | undefined) {
    const servicio = await this.prisma.servicio.findUnique({ where: { id }, select: { id: true, precio: true } });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    const monto = anticipoMonto && anticipoMonto > 0 ? anticipoMonto : null;
    if (monto !== null && Math.round(monto * 100) > Math.round(Number(servicio.precio) * 100)) {
      throw new BadRequestException('El anticipo no puede ser mayor que el precio del servicio');
    }
    const data = await this.prisma.servicio.update({ where: { id }, data: { anticipoMonto: monto } });
    return { success: true, data };
  }
}
