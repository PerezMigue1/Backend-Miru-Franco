import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const MSG_STOCK = 'Stock insuficiente';

export type LineaStock = { presentacionId: number; cantidad: number };

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
): Promise<void> {
  for (const [presentacionId, cantidad] of cantidades) {
    if (cantidad <= 0) continue;
    const r = await tx.productoPresentacion.updateMany({
      where: {
        id: presentacionId,
        disponible: true,
        stock: { gte: cantidad },
      },
      data: { stock: { decrement: cantidad } },
    });
    if (r.count !== 1) {
      throw new BadRequestException(MSG_STOCK);
    }
  }
}

export async function incrementarStockPresentaciones(
  tx: Prisma.TransactionClient,
  cantidades: Map<number, number>,
): Promise<void> {
  for (const [presentacionId, cantidad] of cantidades) {
    if (cantidad <= 0) continue;
    await tx.productoPresentacion.update({
      where: { id: presentacionId },
      data: { stock: { increment: cantidad } },
    });
  }
}

export async function incrementarStockPorLineas(
  tx: Prisma.TransactionClient,
  lines: LineaStock[],
): Promise<void> {
  await incrementarStockPresentaciones(tx, cantidadPorPresentacion(lines));
}
