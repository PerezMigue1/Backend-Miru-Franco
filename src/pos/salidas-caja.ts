import { BadRequestException } from '@nestjs/common';
import { ConceptoMovimientoCaja, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export interface DatosSalidaEfectivo {
  concepto: ConceptoMovimientoCaja;
  monto: Decimal | number | string;
  /** Quien entrega el efectivo: la salida se descuenta en su siguiente corte. */
  registradoPorId: string;
  pagoId?: number | null;
  devolucionId?: number | null;
  motivo?: string | null;
}

/**
 * Opciones de las transacciones de reembolso: con la latencia a Neon varias idas y vueltas superan los
 * 5 s por defecto de Prisma (igual que el candado de citas).
 */
export const TX_HOLGADA = { timeout: 15_000 } as const;

/** Un reembolso solo saca dinero de la caja si el cobro original entró en efectivo por el salón. */
export function esCobroEnEfectivoDelSalon(pago: { metodo: string; cobradoPorId: string | null }): boolean {
  return pago.metodo === 'efectivo' && !!pago.cobradoPorId;
}

/**
 * Registra una salida de efectivo sin corte. La toma el primer corte que haga quien la registró, aunque el
 * cobro original sea de un día ya cortado. Debe llamarse dentro de la misma transacción del reembolso; la
 * llave única de pago_id o devolucion_id impide dos salidas por el mismo reembolso.
 */
export async function registrarSalidaEfectivo(tx: Prisma.TransactionClient, datos: DatosSalidaEfectivo) {
  const monto = new Decimal(datos.monto);
  if (!monto.isFinite() || monto.lte(0)) {
    throw new BadRequestException('El monto de la salida de caja debe ser mayor a cero');
  }
  const origenes = [datos.pagoId, datos.devolucionId].filter((v) => v != null).length;
  if (origenes !== 1) {
    throw new BadRequestException('La salida de caja debe venir de un pago o de una devolución');
  }
  return tx.movimientoCaja.create({
    data: {
      tipo: 'salida',
      concepto: datos.concepto,
      monto,
      motivo: datos.motivo ?? null,
      registradoPorId: datos.registradoPorId,
      pagoId: datos.pagoId ?? null,
      devolucionId: datos.devolucionId ?? null,
    },
  });
}
