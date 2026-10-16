import { EstadoPedido } from '@prisma/client';
import { mensajePlazoRevocacionTerminado, plazoRevocacion, productoConClienta } from './revocacion';

/**
 * Revocación de compra (art. 56 de la Ley Federal de Protección al Consumidor): 5 días hábiles desde la
 * entrega en el salón o, si no se ha entregado, desde el pago. Días hábiles del salón: no cuentan los
 * domingos ni los festivos oficiales; el sábado sí cuenta. Vence al final del 5.º día hábil, hora de México.
 *
 * Calendario de las pruebas (noviembre de 2026): entrega el jueves 12.
 *   vie 13 (1), sáb 14 (2), dom 15 no cuenta, lun 16 festivo (tercer lunes de noviembre), mar 17 (3),
 *   mié 18 (4), jue 19 (5) -> vence el jueves 19 a las 23:59:59.999 de México; el viernes 20 es el día 6.
 */
const ENTREGA = new Date('2026-11-12T17:00:00-06:00');
const VENCE = new Date('2026-11-19T23:59:59.999-06:00');
const pedido = (extra: Partial<Parameters<typeof plazoRevocacion>[0]> = {}) => ({
  estado: EstadoPedido.entregado,
  pagadoEn: new Date('2026-11-02T12:00:00-06:00'),
  entregadoEn: ENTREGA,
  yaRevocado: false,
  ...extra,
});

describe('Plazo de revocación: 5 días hábiles', () => {
  it('cuenta desde la entrega, salta domingo y festivo y cuenta el sábado: vence el jueves 19 a las 23:59:59.999 de México', () => {
    expect(plazoRevocacion(pedido(), ENTREGA).revocableHasta).toEqual(VENCE);
  });

  it('el día 5 hábil todavía se puede revocar, hasta el último milisegundo', () => {
    expect(plazoRevocacion(pedido(), new Date('2026-11-19T10:00:00-06:00')).puedeRevocar).toBe(true);
    expect(plazoRevocacion(pedido(), VENCE).puedeRevocar).toBe(true);
  });

  it('el día 6 hábil ya no', () => {
    expect(plazoRevocacion(pedido(), new Date('2026-11-20T00:00:00-06:00')).puedeRevocar).toBe(false);
    expect(plazoRevocacion(pedido(), new Date('2026-11-20T12:00:00-06:00')).puedeRevocar).toBe(false);
  });

  it('el sábado cuenta como hábil: pagado el martes 10 (sin entregar) vence el martes 17', () => {
    // mié 11 (1), jue 12 (2), vie 13 (3), sáb 14 (4), dom 15 no, lun 16 festivo, mar 17 (5).
    const r = plazoRevocacion(pedido({ estado: EstadoPedido.pagado, entregadoEn: null, pagadoEn: new Date('2026-11-10T09:00:00-06:00') }));
    expect(r.revocableHasta).toEqual(new Date('2026-11-17T23:59:59.999-06:00'));
  });

  it('sin entregar, el plazo corre desde el pago', () => {
    const r = plazoRevocacion(pedido({ estado: EstadoPedido.preparando, entregadoEn: null, pagadoEn: ENTREGA }), new Date('2026-11-19T20:00:00-06:00'));
    expect(r).toEqual({ revocableHasta: VENCE, puedeRevocar: true });
  });

  it('entregado sin fila de entrega en el historial (pedidos anteriores): corre desde el pago', () => {
    expect(plazoRevocacion(pedido({ entregadoEn: null, pagadoEn: ENTREGA })).revocableHasta).toEqual(VENCE);
  });

  it.each([EstadoPedido.pagado, EstadoPedido.preparando, EstadoPedido.listo_recoger, EstadoPedido.entregado])('%s y pagado: se puede revocar', (estado) => {
    expect(plazoRevocacion(pedido({ estado }), ENTREGA).puedeRevocar).toBe(true);
  });

  it.each([EstadoPedido.cancelado, EstadoPedido.pendiente_pago, EstadoPedido.borrador])('%s: no se puede revocar', (estado) => {
    expect(plazoRevocacion(pedido({ estado }), ENTREGA)).toEqual({ revocableHasta: null, puedeRevocar: false });
  });

  it('sin pago ni entrega (apartado en preparación) no hay compra que revocar', () => {
    expect(plazoRevocacion(pedido({ estado: EstadoPedido.preparando, pagadoEn: null, entregadoEn: null }), ENTREGA)).toEqual({
      revocableHasta: null,
      puedeRevocar: false,
    });
  });

  it('ya revocado: conserva la fecha pero no se puede revocar otra vez', () => {
    expect(plazoRevocacion(pedido({ yaRevocado: true }), ENTREGA)).toEqual({ revocableHasta: VENCE, puedeRevocar: false });
  });

  it('enviado (estado heredado): corre desde la fecha de enviado del historial; sin ella, desde el pago', () => {
    const enviado = pedido({ estado: EstadoPedido.enviado, entregadoEn: null, enviadoEn: ENTREGA });
    expect(plazoRevocacion(enviado, ENTREGA)).toEqual({ revocableHasta: VENCE, puedeRevocar: true });
    const sinFecha = pedido({ estado: EstadoPedido.enviado, entregadoEn: null, enviadoEn: null, pagadoEn: ENTREGA });
    expect(plazoRevocacion(sinFecha, ENTREGA).revocableHasta).toEqual(VENCE);
  });
});

describe('Dónde está el producto al revocar', () => {
  it('entregado y el heredado enviado: con la clienta (la revocación espera que lo devuelva); los demás estados, en el salón', () => {
    expect(productoConClienta(EstadoPedido.entregado)).toBe(true);
    expect(productoConClienta(EstadoPedido.enviado)).toBe(true);
    for (const estado of [EstadoPedido.pagado, EstadoPedido.preparando, EstadoPedido.listo_recoger]) {
      expect(productoConClienta(estado)).toBe(false);
    }
  });
});

describe('Mensaje del plazo terminado', () => {
  it('dice en español el día en que terminó, en hora de México', () => {
    expect(mensajePlazoRevocacionTerminado(VENCE)).toBe(
      'El plazo para revocar tu compra terminó el jueves, 19 de noviembre de 2026. Si tienes un problema con tu pedido, comunícate con el salón.',
    );
  });
});

describe('Revocación con los días hábiles guardados en el pedido (mínimo de ley 5)', () => {
  it('con 7 días hábiles guardados, el plazo llega al séptimo día hábil', () => {
    // vie 13 (1), sáb 14 (2), mar 17 (3), mié 18 (4), jue 19 (5), vie 20 (6), sáb 21 (7)
    const r = plazoRevocacion(pedido({ diasHabiles: 7 }), ENTREGA);
    expect(r.revocableHasta).toEqual(new Date('2026-11-21T23:59:59.999-06:00'));
  });

  it('nunca menos de 5 aunque el pedido diga otra cosa (piso de ley)', () => {
    expect(plazoRevocacion(pedido({ diasHabiles: 3 }), ENTREGA).revocableHasta).toEqual(VENCE);
  });
});

describe('Días inhábiles del salón (Reglas) en el cálculo de días hábiles', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { establecerReglasNegocio } = require('../../configuracion-sitio/reglas-negocio');
  afterEach(() => establecerReglasNegocio(null));
  it('un día inhábil guardado en el pedido (mié 18) recorre el vencimiento al viernes 20', () => {
    expect(plazoRevocacion(pedido({ diasInhabiles: ['2026-11-18'] }), ENTREGA).revocableHasta).toEqual(new Date('2026-11-20T23:59:59.999-06:00'));
  });

  it('un día inhábil agregado después de crear el pedido no mueve su plazo', () => {
    establecerReglasNegocio({ diasInhabiles: [{ fecha: '2026-11-18', motivo: 'Inventario' }] });
    expect(plazoRevocacion(pedido({ diasInhabiles: [] }), ENTREGA).revocableHasta).toEqual(VENCE);
  });
});
