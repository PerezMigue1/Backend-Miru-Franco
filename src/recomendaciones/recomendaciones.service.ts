import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

export interface Recomendacion {
  item: string;
  basadoEn: string;
  confianza: number;
  lift: number;
  tipo: string;
  /** 'producto' | 'servicio' | null si el nombre no coincide con el catálogo actual. */
  tipoItem: 'producto' | 'servicio' | null;
  /** id real en `productos` o `servicios`, para poder enlazar al detalle. null si no se encontró. */
  id: number | null;
  /** Miniatura resuelta del catálogo. null si no se encontró match o no tiene imagen. */
  imagenUrl: string | null;
}

/** Extrae una URL de un valor de imagen que puede venir como string suelto o como objeto Cloudinary (`secure_url`/`url`/`src`). */
function extraerUrlImagen(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const url = o.secure_url ?? o.url ?? o.src;
    return typeof url === 'string' && url.trim() ? url : null;
  }
  return null;
}

/** Resuelve `Servicio.imagen` (Json: string suelto | array de strings | array de objetos Cloudinary) a una sola URL. */
function resolverImagenServicio(imagen: unknown): string | null {
  if (Array.isArray(imagen)) {
    for (const item of imagen) {
      const url = extraerUrlImagen(item);
      if (url) return url;
    }
    return null;
  }
  return extraerUrlImagen(imagen);
}

@Injectable()
export class RecomendacionesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dado lo que el cliente ya tiene (servicios/productos), devuelve
   * ítems recomendados según las reglas de asociación calculadas con
   * Apriori (tabla `reglas_asociacion`).
   *
   * No ejecuta Apriori en cada petición: solo lee reglas ya
   * calculadas, así que es una consulta rápida y barata.
   */
  async recomendar(items: string[], topN = 5, tipo?: string): Promise<{ success: true; count: number; data: Recomendacion[] }> {
    const itemsSanitizados = items
      .map((i) => sanitizeInput((i ?? '').trim()))
      .filter((i) => i.length > 0);

    if (itemsSanitizados.length === 0) {
      throw new BadRequestException('Debes enviar al menos un ítem (servicio o producto).');
    }

    for (const item of itemsSanitizados) {
      if (containsSQLInjection(item)) {
        console.warn('⚠️ Intento de SQL injection detectado en recomendaciones:', sanitizeForLogging({ item }));
        throw new BadRequestException('Ítem inválido.');
      }
    }

    const where: any = { antecedente: { in: itemsSanitizados } };
    if (tipo) where.tipo = tipo;

    const reglas = await this.prisma.reglaAsociacion.findMany({
      where,
      orderBy: { lift: 'desc' },
    });

    const yaTiene = new Set(itemsSanitizados.map((i) => i.toLowerCase()));
    const yaRecomendado = new Set<string>();
    const nombresCandidatos: Recomendacion[] = [];

    for (const regla of reglas) {
      const consecuenteLower = regla.consecuente.toLowerCase();
      if (yaTiene.has(consecuenteLower) || yaRecomendado.has(consecuenteLower)) continue;

      yaRecomendado.add(consecuenteLower);
      nombresCandidatos.push({
        item: regla.consecuente,
        basadoEn: regla.antecedente,
        confianza: Number(regla.confianza),
        lift: Number(regla.lift),
        tipo: regla.tipo,
        tipoItem: null,
        id: null,
        imagenUrl: null,
      });

      if (nombresCandidatos.length >= topN) break;
    }

    // Resuelve cada nombre recomendado contra el catálogo real, para poder
    // enlazar directo al detalle del producto/servicio en el frontend.
    const nombres = nombresCandidatos.map((r) => r.item);
    if (nombres.length > 0) {
      const [productos, servicios] = await Promise.all([
        this.prisma.producto.findMany({
          where: { nombre: { in: nombres } },
          select: {
            id: true,
            nombre: true,
            presentaciones: { select: { imagenes: true } },
          },
        }),
        this.prisma.servicio.findMany({
          where: { nombre: { in: nombres } },
          select: { id: true, nombre: true, imagen: true },
        }),
      ]);

      const productoPorNombre = new Map(productos.map((p) => [p.nombre, p]));
      const servicioPorNombre = new Map(servicios.map((s) => [s.nombre, s]));

      for (const rec of nombresCandidatos) {
        const producto = productoPorNombre.get(rec.item);
        const servicio = servicioPorNombre.get(rec.item);
        if (producto) {
          rec.tipoItem = 'producto';
          rec.id = producto.id;
          const presentacionConImagen = producto.presentaciones.find((p) => p.imagenes.length > 0);
          rec.imagenUrl = presentacionConImagen ? presentacionConImagen.imagenes[0] : null;
        } else if (servicio) {
          rec.tipoItem = 'servicio';
          rec.id = servicio.id;
          rec.imagenUrl = resolverImagenServicio(servicio.imagen);
        }
      }
    }

    const recomendaciones = nombresCandidatos;

    return {
      success: true,
      count: recomendaciones.length,
      data: recomendaciones,
    };
  }
}
