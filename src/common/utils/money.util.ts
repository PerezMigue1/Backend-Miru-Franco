import { BadRequestException } from '@nestjs/common';

/**
 * Precio de `ProductoPresentacion` (Prisma `Decimal` o número) → número para cálculos.
 */
export function precioPresentacionANumero(precio: unknown): number {
  if (precio === null || precio === undefined) {
    throw new BadRequestException('Precio de presentación no definido');
  }
  const n = typeof precio === 'number' ? precio : Number(precio);
  if (Number.isNaN(n) || n < 0) {
    throw new BadRequestException('Precio de presentación inválido');
  }
  return n;
}
