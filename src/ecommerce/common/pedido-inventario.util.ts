import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const MSG_STOCK = 'Stock insuficiente';

export type LineaStock = { presentacionId: number; cantidad: number };
export type MovimientoTipo = 'entrada' | 'salida' | 'ajuste';
export type MovimientoMeta = {
  usuarioId?: string;
  referenciaTipo?: string;
  referenciaId?: string;
  motivo?: string;
};

/** Suma cantidades por presentación (misma presentación en varias líneas del pedido). */
export function cantidadPorPresentacion(lines: LineaStock[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const l of lines) {
    m.set(l.presentacionId, (m.get(l.presentacionId) ?? 0) + l.cantidad);
  }
  return m;
}

/**
 * Descuenta stock de forma atómica (evita condiciones de carrera).
 * Exige disponible=true y stock >= cantidad.
 */
export async function decrementarStockPresentaciones(
  tx: Prisma.TransactionClient,
  cantidades: Map<number, number>,
  meta?: MovimientoMeta,
): Promise<void> {
  for (const [presentacionId, cantidad] of cantidades) {
    if (cantidad <= 0) continue;
    const rows = await tx.$queryRaw<{ stock: number }[]>(
      Prisma.sql`UPDATE "producto_presentaciones"
                 SET "stock" = "stock" - ${cantidad}
                 WHERE id = ${presentacionId}
                   AND disponible = true
                   AND stock >= ${cantidad}
                 RETURNING stock`,
    );
    if (rows.length !== 1) {
      throw new BadRequestException(MSG_STOCK);
    }
    const stockDespues = Number(rows[0].stock);
    const stockAntes = stockDespues + cantidad;
    await registrarMovimiento(tx, {
      tipo: 'salida',
      presentacionId,
      cantidad,
      stockAntes,
      stockDespues,
      ...meta,
    });
  }
}

export async function incrementarStockPresentaciones(
  tx: Prisma.TransactionClient,
  cantidades: Map<number, number>,
  meta?: MovimientoMeta,
): Promise<void> {
  for (const [presentacionId, cantidad] of cantidades) {
    if (cantidad <= 0) continue;
    const rows = await tx.$queryRaw<{ stock: number }[]>(
      Prisma.sql`UPDATE "producto_presentaciones"
                 SET "stock" = "stock" + ${cantidad}
                 WHERE id = ${presentacionId}
                 RETURNING stock`,
    );
    if (rows.length !== 1) {
      throw new BadRequestException('Presentación no encontrada');
    }
    const stockDespues = Number(rows[0].stock);
    const stockAntes = stockDespues - cantidad;
    await registrarMovimiento(tx, {
      tipo: 'entrada',
      presentacionId,
      cantidad,
      stockAntes,
      stockDespues,
      ...meta,
    });
  }
}

export async function incrementarStockPorLineas(
  tx: Prisma.TransactionClient,
  lines: LineaStock[],
  meta?: MovimientoMeta,
): Promise<void> {
  await incrementarStockPresentaciones(tx, cantidadPorPresentacion(lines), meta);
}

async function registrarMovimiento(
  tx: Prisma.TransactionClient,
  movimiento: {
    tipo: MovimientoTipo;
    presentacionId: number;
    cantidad: number;
    stockAntes: number;
    stockDespues: number;
    usuarioId?: string;
    referenciaTipo?: string;
    referenciaId?: string;
    motivo?: string;
  },
) {
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "inventario_movimientos"
      ("tipo", "motivo", "cantidad", "stock_antes", "stock_despues", "referencia_tipo", "referencia_id", "presentacion_id", "usuario_id")
      VALUES
      (${movimiento.tipo}::"MovimientoInventarioTipo", ${movimiento.motivo ?? null}, ${movimiento.cantidad}, ${movimiento.stockAntes}, ${movimiento.stockDespues}, ${movimiento.referenciaTipo ?? null}, ${movimiento.referenciaId ?? null}, ${movimiento.presentacionId}, ${movimiento.usuarioId ?? null})`,
  );
}
