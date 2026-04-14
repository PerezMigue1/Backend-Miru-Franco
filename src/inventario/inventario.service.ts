import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListMovimientosDto } from './dto/list-movimientos.dto';

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
}
