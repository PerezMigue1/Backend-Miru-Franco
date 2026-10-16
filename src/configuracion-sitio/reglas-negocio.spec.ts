import {
  DEFINICIONES_REGLAS,
  REGLAS_POR_OMISION,
  establecerReglasNegocio,
  instantaneaReglasCita,
  instantaneaReglasPedido,
  reglasNegocio,
  validarReglas,
  variablesDeReglas,
  reglasDeCita,
  reglasDePedido,
} from './reglas-negocio';
import { anticiposDesde } from '../citas/anticipos/anticipos.util';

/**
 * Reglas de negocio administrables (Admin > Configuración del sitio > Reglas). Los valores por omisión son los que
 * hoy están en el código, así que desplegar no cambia nada. Los plazos de ley no se pueden bajar.
 */
const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  establecerReglasNegocio(null);
});

describe('Valores por omisión (los de hoy)', () => {
  it('citas y anticipos', () => {
    expect(REGLAS_POR_OMISION.citas).toMatchObject({
      plazoAnticipoHoras: 2,
      minutosAntesPagoSalon: 15,
      minutosLlegadaAntes: 20,
      toleranciaLlegadaMinutos: 15,
      porcentajeAnticipoSugerido: 0,
      horasAvisoCancelarReagendar: 0,
      noAsistio: { pierdeAnticipo: true, mesesSoloPagoEnLinea: 6 },
      maxCitasPorPagarEnSalon: 1,
      permitirAnticipoEnSalon: true,
      intervaloHorariosMinutos: 30,
      recordatoriosHorasAntes: [24, 1],
      diasHabilesExcepcionAnticipo: 10,
      diasHabilesCancelarConReembolso: 5,
    });
  });

  it('tienda, plazos legales, garantía, factura, pagos y días inhábiles', () => {
    expect(REGLAS_POR_OMISION.tienda).toMatchObject({
      plazoPagoLineaHoras: 24,
      diasPrepararApartado: 3,
      diaRecordatorioRecoger: 3,
      diasCancelarNoRecogido: 7,
      diasResguardoPagado: 15,
      diasCambioProducto: 7,
    });
    expect(REGLAS_POR_OMISION.tienda.tiempoPreparacionTexto).toBe('Suele estar listo en 24 a 48 horas hábiles');
    expect(REGLAS_POR_OMISION.revocacion.diasHabiles).toBe(5);
    expect(REGLAS_POR_OMISION.arco).toEqual({ diasHabilesRespuesta: 20, diasHabilesEfectividad: 15, diasAvisoVencePronto: 5 });
    expect(REGLAS_POR_OMISION.garantia.diasServicio).toBe(7);
    expect(REGLAS_POR_OMISION.facturacion.plazoTexto).toBe('dentro del mismo mes de tu compra o servicio');
    expect(REGLAS_POR_OMISION.pagos).toMatchObject({
      mercadoPagoTienda: true,
      mercadoPagoAnticipos: true,
      salon: { efectivo: true, tarjeta: true, transferencia: true },
    });
    expect(REGLAS_POR_OMISION.diasInhabiles).toEqual([]);
  });

  it('sin nada guardado, reglasNegocio() devuelve los valores de hoy', () => {
    expect(reglasNegocio()).toEqual(REGLAS_POR_OMISION);
  });
});

describe('Validación (rangos, mensajes en español y pisos de ley)', () => {
  it('lo guardado hoy (solo anticiposDesde) sigue siendo válido y se completa con los valores por omisión', () => {
    const { limpio, errores } = validarReglas({ anticiposDesde: '2026-11-01' });
    expect(errores).toEqual([]);
    expect(limpio.anticiposDesde).toBe('2026-11-01');
    expect(limpio.citas.plazoAnticipoHoras).toBe(2);
  });

  it('un cambio válido se conserva y lo demás queda igual', () => {
    const { limpio, errores } = validarReglas({ citas: { plazoAnticipoHoras: 3 }, tienda: { diasResguardoPagado: 20 } });
    expect(errores).toEqual([]);
    expect(limpio.citas.plazoAnticipoHoras).toBe(3);
    expect(limpio.citas.minutosAntesPagoSalon).toBe(15);
    expect(limpio.tienda.diasResguardoPagado).toBe(20);
  });

  it.each([
    ['revocación de 4 días hábiles (la ley pide al menos 5)', { revocacion: { diasHabiles: 4 } }, /revocar.*al menos 5/i],
    ['ARCO de 19 días hábiles (la ley pide 20)', { arco: { diasHabilesRespuesta: 19 } }, /20 días hábiles/],
    ['efectividad ARCO de 10 días hábiles (la ley pide 15)', { arco: { diasHabilesEfectividad: 10 } }, /15 días hábiles/],
    ['cancelar con reembolso en 4 días hábiles (mínimo 5)', { citas: { diasHabilesCancelarConReembolso: 4 } }, /al menos 5/],
    ['plazo de anticipo de 0 horas', { citas: { plazoAnticipoHoras: 0 } }, /plazo para pagar el anticipo/i],
    ['plazo de anticipo de 100 horas', { citas: { plazoAnticipoHoras: 100 } }, /plazo para pagar el anticipo/i],
    ['porcentaje sugerido de 120', { citas: { porcentajeAnticipoSugerido: 120 } }, /porcentaje/i],
    ['recordatorio después de cancelar el apartado', { tienda: { diaRecordatorioRecoger: 8, diasCancelarNoRecogido: 7 } }, /recordatorio/i],
    ['intervalo de horarios de 7 minutos', { citas: { intervaloHorariosMinutos: 7 } }, /horarios/i],
    ['un número con decimales', { tienda: { diasPrepararApartado: 2.5 } }, /entero/i],
    ['texto en lugar de número', { garantia: { diasServicio: 'siete' } }, /garantía/i],
    ['día inhábil con fecha inválida', { diasInhabiles: [{ fecha: '2026-02-30', motivo: 'x' }] }, /fecha/i],
    ['transferencia activa sin CLABE', { pagos: { salon: { transferencia: true }, transferencia: { banco: 'Banco', titular: 'Titular', clabe: '' } } }, /CLABE/],
    ['CLABE con letras', { pagos: { transferencia: { banco: 'Banco', titular: 'Titular', clabe: '01234567890123456X' } } }, /CLABE/],
    ['un campo que no existe', { citas: { otro: 1 } }, /no se reconocen/],
  ])('%s: error en español', (_caso, valor, mensaje) => {
    const { errores } = validarReglas(valor);
    expect(errores.join(' ')).toMatch(mensaje);
  });

  it('sin datos de transferencia, la transferencia en el salón queda válida solo si no se piden datos (se muestran solo si están completos)', () => {
    expect(validarReglas({ pagos: { salon: { transferencia: true }, transferencia: { banco: '', titular: '', clabe: '' } } }).errores).toEqual([]);
  });

  it('el anticipo siempre conserva una forma de pago: no se pueden apagar en línea y salón a la vez', () => {
    expect(validarReglas({ pagos: { mercadoPagoAnticipos: false }, citas: { permitirAnticipoEnSalon: false } }).errores.join(' ')).toMatch(/al menos una forma de pago/);
    expect(validarReglas({ pagos: { mercadoPagoAnticipos: false, salon: { efectivo: false, tarjeta: false, transferencia: false } } }).errores.join(' ')).toMatch(/al menos un método/);
    expect(validarReglas({ pagos: { mercadoPagoAnticipos: false } }).errores).toEqual([]);
  });

  it('cada regla tiene etiqueta y explicación de qué afecta; las de ley dicen su mínimo', () => {
    for (const d of DEFINICIONES_REGLAS) {
      expect([d.ruta, d.etiqueta.length > 3]).toEqual([d.ruta, true]);
      expect([d.ruta, d.afecta.length > 10]).toEqual([d.ruta, true]);
    }
    expect(DEFINICIONES_REGLAS.find((d) => d.ruta === 'revocacion.diasHabiles')).toMatchObject({ min: 5, minimoLegal: true });
    expect(DEFINICIONES_REGLAS.find((d) => d.ruta === 'arco.diasHabilesRespuesta')).toMatchObject({ min: 20, minimoLegal: true });
  });
});

describe('Reglas vigentes en el backend', () => {
  it('establecerReglasNegocio con lo guardado cambia lo que leen los servicios; null vuelve a los de hoy', () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: 3 } });
    expect(reglasNegocio().citas.plazoAnticipoHoras).toBe(3);
    establecerReglasNegocio(null);
    expect(reglasNegocio().citas.plazoAnticipoHoras).toBe(2);
  });

  it('un valor guardado inválido no rompe: se usa el de hoy para esa regla', () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: -4 }, tienda: { diasResguardoPagado: 30 } });
    expect(reglasNegocio().citas.plazoAnticipoHoras).toBe(2);
    expect(reglasNegocio().tienda.diasResguardoPagado).toBe(30);
  });

  it('anticiposDesde: la regla manda y ANTICIPOS_DESDE queda de respaldo', () => {
    process.env.ANTICIPOS_DESDE = '2026-01-01';
    establecerReglasNegocio({ anticiposDesde: null });
    expect(anticiposDesde()?.toISOString()).toBe('2026-01-01T06:00:00.000Z');
    establecerReglasNegocio({ anticiposDesde: '2026-12-01' });
    expect(anticiposDesde()?.toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });

  it('apartadosDesde: la regla manda y APARTADOS_DESDE queda de respaldo', () => {
    process.env.APARTADOS_DESDE = '2026-02-01';
    expect(reglasNegocio().tienda.apartadosDesde).toBeNull();
    establecerReglasNegocio({ tienda: { apartadosDesde: '2026-03-01' } });
    expect(reglasNegocio().tienda.apartadosDesde).toBe('2026-03-01');
  });
});

describe('Lo que se guarda en cada cita y pedido (la regla con que se crearon)', () => {
  it('cita: los plazos y la política de anticipo vigentes al crearla', () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: 3, horasAvisoCancelarReagendar: 12 }, diasInhabiles: [{ fecha: '2026-12-24', motivo: '' }] });
    expect(instantaneaReglasCita()).toEqual({
      plazoAnticipoHoras: 3,
      minutosAntesPagoSalon: 15,
      horasAvisoCancelarReagendar: 12,
      diasHabilesExcepcionAnticipo: 10,
      diasHabilesCancelarConReembolso: 5,
      pierdeAnticipoSiNoAsiste: true,
      diasInhabiles: ['2026-12-24'],
    });
  });

  it('pedido: los plazos de pago, apartado, resguardo, cambios y revocación vigentes al crearlo', () => {
    establecerReglasNegocio({ tienda: { plazoPagoLineaHoras: 48 } });
    expect(instantaneaReglasPedido()).toEqual({
      plazoPagoLineaHoras: 48,
      diasPrepararApartado: 3,
      diaRecordatorioRecoger: 3,
      diasCancelarNoRecogido: 7,
      diasResguardoPagado: 15,
      diasCambioProducto: 7,
      diasHabilesRevocacion: 5,
      diasInhabiles: [],
    });
  });

  it('citas y pedidos anteriores (sin reglas guardadas): sin días inhábiles del salón, aunque hoy haya', () => {
    establecerReglasNegocio({ diasInhabiles: [{ fecha: '2026-12-24', motivo: '' }] });
    expect(reglasDeCita(null).diasInhabiles).toEqual([]);
    expect(reglasDePedido(null).diasInhabiles).toEqual([]);
    expect(reglasDeCita({ diasInhabiles: ['2026-12-24', 'x'] }).diasInhabiles).toEqual([]);
    expect(reglasDeCita({ diasInhabiles: ['2026-12-24'] }).diasInhabiles).toEqual(['2026-12-24']);
  });

  it('la excepción del anticipo no puede pasar de 10 días hábiles (la política publicada)', () => {
    expect(validarReglas({ citas: { diasHabilesExcepcionAnticipo: 11 } }).errores.join(' ')).toMatch(/como máximo 10/);
  });
});

describe('Variables para textos y documentos ({plazoAnticipoHoras}, {diasResguardo}...)', () => {
  it('salen de las reglas vigentes', () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: 3 } });
    const v = variablesDeReglas();
    expect(v.plazoAnticipoHoras).toBe('3');
    expect(v.diasResguardo).toBe('15');
    expect(v.diasHabilesRevocacion).toBe('5');
    expect(v.minutosAntesPagoSalon).toBe('15');
    expect(Object.keys(v).length).toBeGreaterThanOrEqual(18);
  });
});
