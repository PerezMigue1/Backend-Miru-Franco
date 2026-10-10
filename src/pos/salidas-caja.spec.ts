import { Decimal } from '@prisma/client/runtime/library';
import { registrarSalidaEfectivo, esCobroEnEfectivoDelSalon } from './salidas-caja';

function txFalso() {
  const creados: any[] = [];
  return {
    creados,
    movimientoCaja: {
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: creados.length + 1, corteId: null, ...data };
        creados.push(fila);
        return fila;
      }),
    },
  };
}

describe('registrarSalidaEfectivo', () => {
  it('crea una salida sin corte, ligada al pago y a quien la registra', async () => {
    const tx = txFalso();
    const salida = await registrarSalidaEfectivo(tx as any, {
      concepto: 'reembolso_anticipo',
      monto: new Decimal(200),
      registradoPorId: 'cajera-1',
      pagoId: 7,
      motivo: 'Cancelación de la clienta',
    });
    expect(tx.movimientoCaja.create).toHaveBeenCalledTimes(1);
    expect(salida).toMatchObject({
      tipo: 'salida',
      concepto: 'reembolso_anticipo',
      registradoPorId: 'cajera-1',
      pagoId: 7,
      corteId: null,
    });
    expect(Number(salida.monto)).toBe(200);
  });

  it('rechaza montos de cero o negativos', async () => {
    const tx = txFalso();
    await expect(
      registrarSalidaEfectivo(tx as any, { concepto: 'reembolso_pedido', monto: 0, registradoPorId: 'c', pagoId: 1 }),
    ).rejects.toThrow();
    expect(tx.movimientoCaja.create).not.toHaveBeenCalled();
  });

  it('exige exactamente un origen: pago o devolución', async () => {
    const tx = txFalso();
    await expect(
      registrarSalidaEfectivo(tx as any, { concepto: 'reembolso_devolucion', monto: 10, registradoPorId: 'c' }),
    ).rejects.toThrow();
    await expect(
      registrarSalidaEfectivo(tx as any, {
        concepto: 'reembolso_devolucion',
        monto: 10,
        registradoPorId: 'c',
        pagoId: 1,
        devolucionId: 2,
      }),
    ).rejects.toThrow();
    expect(tx.movimientoCaja.create).not.toHaveBeenCalled();
  });
});

describe('esCobroEnEfectivoDelSalon', () => {
  it('solo cuenta pagos en efectivo cobrados por alguien del salón', () => {
    expect(esCobroEnEfectivoDelSalon({ metodo: 'efectivo', cobradoPorId: 'cajera-1' })).toBe(true);
    expect(esCobroEnEfectivoDelSalon({ metodo: 'efectivo', cobradoPorId: null })).toBe(false);
    expect(esCobroEnEfectivoDelSalon({ metodo: 'tarjeta_terminal', cobradoPorId: 'cajera-1' })).toBe(false);
    expect(esCobroEnEfectivoDelSalon({ metodo: 'mercadopago', cobradoPorId: null })).toBe(false);
  });
});
