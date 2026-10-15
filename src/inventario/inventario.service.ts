import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListMovimientosDto } from './dto/list-movimientos.dto';
import { AlertasStockDto } from './dto/alertas-stock.dto';
import { CaducidadesDto } from './dto/caducidades.dto';
import { ConteoFisicoDto } from './dto/conteo-fisico.dto';
import { CreateAjusteDto } from './dto/create-ajuste.dto';
import { CreateEntradaDto } from './dto/create-entrada.dto';
import { CreateSalidaDto } from './dto/create-salida.dto';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { normalizarRangoFechas, normalizarRangoFechasSoloDia } from '../common/utils/fecha-rango.util';
import { diaEnMexico, diasHastaDiaCalendario, sumarDias } from '../common/utils/zona-mexico';
import {
  ESTADOS_PEDIDO_VENDIDO,
  SEMANAS_PREDICCION,
  calcularFilaPrediccion,
  ventanaUltimas8Semanas,
} from './prediccion-inventario';

type MovimientoRow = {
  id: number;
  tipo: 'entrada' | 'salida' | 'ajuste';
  motivo: string | null;
  cantidad: number;
  stock_antes: number;
  stock_despues: number;
  referencia_tipo: string | null;
  referencia_id: string | null;
  creado_en: Date;
  presentacion_id: number;
  producto_id: number;
  producto_nombre: string;
  tamanio: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
};

@Injectable()
export class InventarioService {
  constructor(private readonly prisma: PrismaService) {}

  async listarMovimientos(filtros: ListMovimientosDto) {
    const page = filtros.page ?? 1;
    const limit = Math.min(filtros.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const whereParts: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (filtros.tipo) {
      whereParts.push(
        Prisma.sql`m.tipo = ${filtros.tipo}::"MovimientoInventarioTipo"`,
      );
    }
    if (filtros.presentacionId) {
      whereParts.push(Prisma.sql`m.presentacion_id = ${filtros.presentacionId}`);
    }
    if (filtros.productoId) {
      whereParts.push(Prisma.sql`pp.producto_id = ${filtros.productoId}`);
    }
    if (filtros.desde || filtros.hasta) {
      const { gte: desde, lte: hasta } = normalizarRangoFechas(filtros.desde, filtros.hasta);
      if (filtros.desde && !desde) {
        throw new BadRequestException('desde debe ser una fecha ISO válida');
      }
      if (filtros.hasta && !hasta) {
        throw new BadRequestException('hasta debe ser una fecha ISO válida');
      }
      if (desde) whereParts.push(Prisma.sql`m.creado_en >= ${desde}::timestamp`);
      if (hasta) whereParts.push(Prisma.sql`m.creado_en <= ${hasta}::timestamp`);
    }
    if (filtros.q?.trim()) {
      const q = `%${filtros.q.trim()}%`;
      whereParts.push(
        Prisma.sql`(
          p.nombre ILIKE ${q}
          OR pp.tamanio ILIKE ${q}
          OR COALESCE(m.motivo, '') ILIKE ${q}
          OR COALESCE(m.referencia_tipo, '') ILIKE ${q}
          OR COALESCE(m.referencia_id, '') ILIKE ${q}
        )`,
      );
    }

    const where = Prisma.join(whereParts, ' AND ');
    const orderDirection =
      filtros.sort?.toLowerCase() === 'creadoen:asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const countRows = await this.prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS total
                 FROM inventario_movimientos m
                 INNER JOIN producto_presentaciones pp ON pp.id = m.presentacion_id
                 INNER JOIN productos p ON p.id = pp.producto_id
                 WHERE ${where}`,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await this.prisma.$queryRaw<MovimientoRow[]>(
      Prisma.sql`SELECT
                    m.id,
                    m.tipo::text as tipo,
                    m.motivo,
                    m.cantidad,
                    m.stock_antes,
                    m.stock_despues,
                    m.referencia_tipo,
                    m.referencia_id,
                    m.creado_en,
                    m.presentacion_id,
                    pp.producto_id,
                    p.nombre AS producto_nombre,
                    pp.tamanio,
                    m.usuario_id,
                    u.nombre AS usuario_nombre
                 FROM inventario_movimientos m
                 INNER JOIN producto_presentaciones pp ON pp.id = m.presentacion_id
                 INNER JOIN productos p ON p.id = pp.producto_id
                 LEFT JOIN usuarios u ON u.id = m.usuario_id
                 WHERE ${where}
                 ORDER BY m.creado_en ${orderDirection}, m.id DESC
                 LIMIT ${limit} OFFSET ${skip}`,
    );

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: rows.map((r) => ({
        id: r.id,
        tipo: r.tipo,
        motivo: r.motivo,
        cantidad: r.cantidad,
        stockAntes: r.stock_antes,
        stockDespues: r.stock_despues,
        referenciaTipo: r.referencia_tipo,
        referenciaId: r.referencia_id,
        creadoEn: r.creado_en,
        presentacionId: r.presentacion_id,
        productoId: r.producto_id,
        productoNombre: r.producto_nombre,
        tamanio: r.tamanio,
        usuarioId: r.usuario_id,
        usuarioNombre: r.usuario_nombre,
      })),
    };
  }

  /**
   * Registra una entrada de stock. Si se pasa `tx`, se ejecuta dentro de esa
   * transacción (para operaciones compuestas como cancelar venta); si no, abre una propia.
   */
  async registrarEntrada(
    dto: CreateEntradaDto,
    usuarioId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const motivoLimpio = dto.motivo ? sanitizeInput(dto.motivo) : undefined;
    if (motivoLimpio && containsSQLInjection(motivoLimpio)) {
      throw new BadRequestException('Motivo contiene caracteres no permitidos');
    }

    if (tx) return this.aplicarEntrada(tx, dto, usuarioId, motivoLimpio);
    return this.prisma.$transaction((t) => this.aplicarEntrada(t, dto, usuarioId, motivoLimpio));
  }

  private async aplicarEntrada(
    tx: Prisma.TransactionClient,
    dto: CreateEntradaDto,
    usuarioId: string | undefined,
    motivoLimpio: string | undefined,
  ) {
    const presentacion = await tx.productoPresentacion.findUnique({
      where: { id: dto.presentacionId },
      select: { id: true, stock: true },
    });
    if (!presentacion) {
      throw new NotFoundException(`Presentación ${dto.presentacionId} no encontrada`);
    }

    const stockAntes = presentacion.stock;
    const stockDespues = stockAntes + dto.cantidad;

    await tx.productoPresentacion.update({
      where: { id: dto.presentacionId },
      data: { stock: { increment: dto.cantidad } },
    });

    const movimiento = await tx.inventarioMovimiento.create({
      data: {
        tipo: 'entrada',
        motivo: motivoLimpio ?? null,
        cantidad: dto.cantidad,
        stockAntes,
        stockDespues,
        referenciaTipo: dto.referenciaTipo ?? null,
        referenciaId: dto.referenciaId ?? null,
        presentacionId: dto.presentacionId,
        usuarioId: usuarioId ?? null,
      },
    });

    return { success: true, data: { movimientoId: movimiento.id, stockAntes, stockDespues } };
  }

  /**
   * Registra una salida de stock. Si se pasa `tx`, se ejecuta dentro de esa
   * transacción (para descontar inventario junto con la venta POS / materiales de cita).
   */
  async registrarSalida(
    dto: CreateSalidaDto,
    usuarioId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const motivoLimpio = dto.motivo ? sanitizeInput(dto.motivo) : undefined;
    if (motivoLimpio && containsSQLInjection(motivoLimpio)) {
      throw new BadRequestException('Motivo contiene caracteres no permitidos');
    }

    if (tx) return this.aplicarSalida(tx, dto, usuarioId, motivoLimpio);
    return this.prisma.$transaction((t) => this.aplicarSalida(t, dto, usuarioId, motivoLimpio));
  }

  private async aplicarSalida(
    tx: Prisma.TransactionClient,
    dto: CreateSalidaDto,
    usuarioId: string | undefined,
    motivoLimpio: string | undefined,
  ) {
    const presentacion = await tx.productoPresentacion.findUnique({
      where: { id: dto.presentacionId },
      select: { id: true, stock: true },
    });
    if (!presentacion) {
      throw new NotFoundException(`Presentación ${dto.presentacionId} no encontrada`);
    }

    const stockAntes = presentacion.stock;
    const stockDespues = stockAntes - dto.cantidad;

    // Decremento atómico guardado: sólo descuenta si aún hay stock suficiente.
    // Previene sobreventa por concurrencia (dos salidas simultáneas de la misma presentación).
    const res = await tx.productoPresentacion.updateMany({
      where: { id: dto.presentacionId, stock: { gte: dto.cantidad } },
      data: { stock: { decrement: dto.cantidad } },
    });
    if (res.count === 0) {
      throw new BadRequestException(
        `Stock insuficiente. Disponible: ${presentacion.stock}, solicitado: ${dto.cantidad}`,
      );
    }

    const movimiento = await tx.inventarioMovimiento.create({
      data: {
        tipo: 'salida',
        motivo: motivoLimpio ?? null,
        cantidad: dto.cantidad,
        stockAntes,
        stockDespues,
        referenciaTipo: dto.referenciaTipo ?? null,
        referenciaId: dto.referenciaId ?? null,
        presentacionId: dto.presentacionId,
        usuarioId: usuarioId ?? null,
      },
    });

    return { success: true, data: { movimientoId: movimiento.id, stockAntes, stockDespues } };
  }

  async registrarAjuste(dto: CreateAjusteDto, usuarioId?: string) {
    const motivoLimpio = sanitizeInput(dto.motivo);
    if (containsSQLInjection(motivoLimpio)) {
      throw new BadRequestException('Motivo contiene caracteres no permitidos');
    }

    return this.prisma.$transaction(async (tx) => {
      const presentacion = await tx.productoPresentacion.findUnique({
        where: { id: dto.presentacionId },
        select: { id: true, stock: true },
      });
      if (!presentacion) {
        throw new NotFoundException(`Presentación ${dto.presentacionId} no encontrada`);
      }

      const stockAntes = presentacion.stock;
      const cantidad = Math.abs(dto.stockReal - stockAntes);

      await tx.productoPresentacion.update({
        where: { id: dto.presentacionId },
        data: { stock: dto.stockReal },
      });

      const movimiento = await tx.inventarioMovimiento.create({
        data: {
          tipo: 'ajuste',
          motivo: motivoLimpio,
          cantidad,
          stockAntes,
          stockDespues: dto.stockReal,
          referenciaTipo: dto.referenciaTipo ?? null,
          referenciaId: dto.referenciaId ?? null,
          presentacionId: dto.presentacionId,
          usuarioId: usuarioId ?? null,
        },
      });

      return {
        success: true,
        data: {
          movimientoId: movimiento.id,
          stockAntes,
          stockDespues: dto.stockReal,
          diferencia: dto.stockReal - stockAntes,
        },
      };
    });
  }

  async conteoFisico(dto: ConteoFisicoDto, usuarioId?: string) {
    const motivoLimpio = dto.motivo ? sanitizeInput(dto.motivo) : 'Conteo físico';

    return this.prisma.$transaction(async (tx) => {
      const resultados: Array<{
        presentacionId: number;
        stockAntes: number;
        stockDespues: number;
        movimientoId: number;
      }> = [];

      for (const item of dto.items) {
        const presentacion = await tx.productoPresentacion.findUnique({
          where: { id: item.presentacionId },
          select: { id: true, stock: true },
        });
        if (!presentacion) {
          throw new NotFoundException(`Presentación ${item.presentacionId} no encontrada`);
        }

        const stockAntes = presentacion.stock;
        const cantidad = Math.abs(item.stockReal - stockAntes);

        await tx.productoPresentacion.update({
          where: { id: item.presentacionId },
          data: { stock: item.stockReal },
        });

        const movimiento = await tx.inventarioMovimiento.create({
          data: {
            tipo: 'ajuste',
            motivo: motivoLimpio,
            cantidad,
            stockAntes,
            stockDespues: item.stockReal,
            presentacionId: item.presentacionId,
            usuarioId: usuarioId ?? null,
          },
        });

        resultados.push({
          presentacionId: item.presentacionId,
          stockAntes,
          stockDespues: item.stockReal,
          movimientoId: movimiento.id,
        });
      }

      return { success: true, count: resultados.length, data: resultados };
    });
  }

  async kardex(presentacionId: number) {
    const presentacion = await this.prisma.productoPresentacion.findUnique({
      where: { id: presentacionId },
      select: {
        id: true,
        tamanio: true,
        stock: true,
        producto: { select: { id: true, nombre: true, marca: true } },
      },
    });
    if (!presentacion) {
      throw new NotFoundException(`Presentación ${presentacionId} no encontrada`);
    }

    const movimientos = await this.prisma.inventarioMovimiento.findMany({
      where: { presentacionId },
      orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tipo: true,
        cantidad: true,
        stockAntes: true,
        stockDespues: true,
        motivo: true,
        referenciaTipo: true,
        referenciaId: true,
        creadoEn: true,
        usuario: { select: { id: true, nombre: true } },
      },
    });

    return {
      success: true,
      presentacion: {
        id: presentacion.id,
        tamanio: presentacion.tamanio,
        stockActual: presentacion.stock,
        producto: presentacion.producto,
      },
      count: movimientos.length,
      data: movimientos,
    };
  }

  async alertasStock(query: AlertasStockDto) {
    const umbral = query.umbral ?? 5;

    // Un producto desactivado ya no se vende: no sale en las alertas.
    const presentaciones = await this.prisma.productoPresentacion.findMany({
      where: { stock: { lte: umbral }, producto: { activo: true } },
      orderBy: { stock: 'asc' },
      select: {
        id: true,
        tamanio: true,
        stock: true,
        disponible: true,
        producto: { select: { id: true, nombre: true, marca: true, categoria: true } },
      },
    });

    return { success: true, umbral, count: presentaciones.length, data: presentaciones };
  }

  /**
   * GET /inventario/prediccion: por presentación de productos activos, unidades vendidas en las
   * últimas 8 semanas (días completos en México) en la tienda en línea (pedidos pagados, en
   * preparación, listos o entregados; fecha de pago o, si falta, de creación) y en el salón (ventas
   * pagadas), con promedio semanal, diario y días de cobertura del stock actual.
   */
  async prediccion(ahora: Date = new Date()) {
    const { desde, hasta } = ventanaUltimas8Semanas(ahora);
    const enVentana = { gte: desde, lt: hasta };

    const [presentaciones, enLinea, enSalon] = await Promise.all([
      this.prisma.productoPresentacion.findMany({
        where: { producto: { activo: true } },
        select: {
          id: true,
          tamanio: true,
          stock: true,
          producto: { select: { id: true, nombre: true, marca: true, categoria: true } },
        },
      }),
      this.prisma.pedidoItem.groupBy({
        by: ['presentacionId'],
        where: {
          pedido: {
            estado: { in: [...ESTADOS_PEDIDO_VENDIDO] },
            OR: [{ pagadoEn: enVentana }, { pagadoEn: null, creadoEn: enVentana }],
          },
        },
        _sum: { cantidad: true },
      }),
      this.prisma.ventaLocalItem.groupBy({
        by: ['presentacionId'],
        where: { presentacionId: { not: null }, venta: { estado: 'pagada', creadoEn: enVentana } },
        _sum: { cantidad: true },
      }),
    ]);

    const vendidas = new Map<number, number>();
    for (const fila of [...enLinea, ...enSalon]) {
      if (fila.presentacionId == null) continue;
      vendidas.set(fila.presentacionId, (vendidas.get(fila.presentacionId) ?? 0) + (fila._sum.cantidad ?? 0));
    }

    const data = presentaciones
      .map((p) => ({
        presentacionId: p.id,
        productoId: p.producto.id,
        producto: p.producto.nombre,
        marca: p.producto.marca,
        categoria: p.producto.categoria,
        tamanio: p.tamanio,
        stock: p.stock,
        ...calcularFilaPrediccion(p.stock, vendidas.get(p.id) ?? 0),
      }))
      // Primero lo que se acaba antes; al final lo que no tuvo ventas.
      .sort((a, b) => {
        if (a.diasCobertura === null || b.diasCobertura === null) {
          if (a.diasCobertura !== b.diasCobertura) return a.diasCobertura === null ? 1 : -1;
          return a.producto.localeCompare(b.producto);
        }
        return a.diasCobertura - b.diasCobertura;
      });

    return {
      success: true,
      ventana: { desde, hasta, semanas: SEMANAS_PREDICCION },
      count: data.length,
      data,
    };
  }

  async caducidades(query: CaducidadesDto) {
    const dias = query.dias ?? 30;
    const ahora = new Date();
    // fechaCaducidad es un día de calendario guardado en UTC (mediodía desde el formulario,
    // medianoche desde importaciones): la ventana llega hasta el final de ese día, hoy (México) + dias.
    const { lte: limite } = normalizarRangoFechasSoloDia(undefined, sumarDias(diaEnMexico(ahora), dias));

    const presentaciones = await this.prisma.productoPresentacion.findMany({
      where: { fechaCaducidad: { lte: limite }, producto: { activo: true } },
      orderBy: { fechaCaducidad: 'asc' },
      select: {
        id: true,
        tamanio: true,
        stock: true,
        fechaCaducidad: true,
        producto: { select: { id: true, nombre: true, marca: true, categoria: true } },
      },
    });

    return {
      success: true,
      dias,
      count: presentaciones.length,
      data: presentaciones.map((p) => {
        // Por día de calendario en México, como el frontend: hoy 0, mañana 1, ayer -1, a cualquier
        // hora. Antes se restaban milisegundos y lo de hoy contaba como vencido desde las 06:00.
        const diasRestantes = diasHastaDiaCalendario(p.fechaCaducidad!, ahora);
        return { ...p, vencida: diasRestantes < 0, diasRestantes };
      }),
    };
  }
}
