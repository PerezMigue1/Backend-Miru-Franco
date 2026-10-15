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

/**
 * Salida de efectivo por la anulación de una venta local que YA entró a un corte. movimientos_caja
 * no tiene columna que la ligue a la venta (sus llaves únicas son de pago o devolución), así que el
 * folio viaja en el motivo; que no haya dos salidas por la misma venta lo garantiza la transición
 * condicional pagada→cancelada (updateMany) dentro de la misma transacción. Nace sin corte_id (no hay
 * cortes "abiertos": el corte se guarda al cerrar caja) y la descuenta el siguiente corte de quien anuló,
 * igual que los reembolsos; por eso PosService.anularVentaCortada solo deja anular a quien opera la caja.
 */
export async function registrarSalidaAnulacionVenta(
  tx: Prisma.TransactionClient,
  datos: { monto: Decimal | number | string; registradoPorId: string; folio: string; motivo: string },
) {
  const monto = new Decimal(datos.monto);
  if (!monto.isFinite() || monto.lte(0)) {
    throw new BadRequestException('El monto de la salida de caja debe ser mayor a cero');
  }
  return tx.movimientoCaja.create({
    data: {
      tipo: 'salida',
      // Sin concepto propio en el enum (agregarlo pediría migración): anular una venta de mostrador
      // devuelve el dinero de esa venta, lo más cercano a un reembolso por devolución. El folio en el
      // motivo identifica la venta.
      concepto: 'reembolso_devolucion',
      monto,
      motivo: `Anulación de venta cortada ${datos.folio}: ${datos.motivo}`,
      registradoPorId: datos.registradoPorId,
      pagoId: null,
      devolucionId: null,
    },
  });
}
