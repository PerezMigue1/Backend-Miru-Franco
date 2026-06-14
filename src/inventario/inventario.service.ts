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
    if (filtros.desde) {
      const desde = new Date(filtros.desde);
      if (Number.isNaN(desde.getTime())) {
        throw new BadRequestException('desde debe ser una fecha ISO válida');
      }
      whereParts.push(Prisma.sql`m.creado_en >= ${desde}::timestamp`);
    }
    if (filtros.hasta) {
      const hasta = new Date(filtros.hasta);
      if (Number.isNaN(hasta.getTime())) {
        throw new BadRequestException('hasta debe ser una fecha ISO válida');
      }
      whereParts.push(Prisma.sql`m.creado_en <= ${hasta}::timestamp`);
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

  async registrarEntrada(dto: CreateEntradaDto, usuarioId?: string) {
    const motivoLimpio = dto.motivo ? sanitizeInput(dto.motivo) : undefined;
    if (motivoLimpio && containsSQLInjection(motivoLimpio)) {
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
      const stockDespues = stockAntes + dto.cantidad;

      await tx.productoPresentacion.update({
        where: { id: dto.presentacionId },
        data: { stock: stockDespues },
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
    });
  }

  async registrarSalida(dto: CreateSalidaDto, usuarioId?: string) {
    const motivoLimpio = dto.motivo ? sanitizeInput(dto.motivo) : undefined;
    if (motivoLimpio && containsSQLInjection(motivoLimpio)) {
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
      if (dto.cantidad > presentacion.stock) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${presentacion.stock}, solicitado: ${dto.cantidad}`,
        );
      }

      const stockAntes = presentacion.stock;
      const stockDespues = stockAntes - dto.cantidad;

      await tx.productoPresentacion.update({
        where: { id: dto.presentacionId },
        data: { stock: stockDespues },
      });

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
    });
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

    const presentaciones = await this.prisma.productoPresentacion.findMany({
      where: { stock: { lte: umbral } },
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

  async caducidades(query: CaducidadesDto) {
    const dias = query.dias ?? 30;
    const ahora = new Date();
    const limite = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);

    const presentaciones = await this.prisma.productoPresentacion.findMany({
      where: { fechaCaducidad: { lte: limite } },
      orderBy: { fechaCaducidad: 'asc' },
      select: {
        id: true,
        tamanio: true,
        stock: true,
        fechaCaducidad: true,
        producto: { select: { id: true, nombre: true, marca: true, categoria: true } },
      },
    });

    const ahora2 = new Date();
    return {
      success: true,
      dias,
      count: presentaciones.length,
      data: presentaciones.map((p) => ({
        ...p,
        vencida: p.fechaCaducidad! < ahora2,
        diasRestantes: Math.ceil(
          (p.fechaCaducidad!.getTime() - ahora2.getTime()) / (1000 * 60 * 60 * 24),
        ),
      })),
    };
  }
}
