import { avisoEntornoPagos, entornoPagos, leerReferencia, referenciaCitaPago, referenciaPedido, referenciasDeBusqueda } from './referencia-pago';

/**
 * external_reference de Mercado Pago con prefijo por entorno ("dev-" o "prod-"): así un aviso de una prueba local
 * nunca se aplica a un pedido o cita de producción, aunque los ids coincidan (desarrollo se copió de producción).
 */
describe('Entorno de los pagos (MP_ENTORNO)', () => {
  it('MP_ENTORNO manda: dev o prod, sin importar mayúsculas ni espacios', () => {
    expect(entornoPagos({ MP_ENTORNO: 'prod' })).toBe('prod');
    expect(entornoPagos({ MP_ENTORNO: ' DEV ', NODE_ENV: 'production' })).toBe('dev');
  });

  it('sin MP_ENTORNO (o con un valor que no es dev ni prod) se deduce de NODE_ENV: production es prod; lo demás, dev', () => {
    expect(entornoPagos({ NODE_ENV: 'production' })).toBe('prod');
    expect(entornoPagos({ NODE_ENV: 'development' })).toBe('dev');
    expect(entornoPagos({})).toBe('dev');
    expect(entornoPagos({ MP_ENTORNO: 'staging', NODE_ENV: 'production' })).toBe('prod');
  });

  it('con Mercado Pago configurado y sin MP_ENTORNO válido, al arrancar se avisa qué entorno se dedujo (sin mostrar el token)', () => {
    const token = 'token-ficticio-123';
    const aviso = avisoEntornoPagos({ MP_ACCESS_TOKEN: token, NODE_ENV: 'production' });
    expect(aviso).toMatch(/MP_ENTORNO/);
    expect(aviso).toMatch(/prod/);
    expect(aviso).not.toContain(token);
    expect(avisoEntornoPagos({ MP_ACCESS_TOKEN: token, MP_ENTORNO: 'staging' })).toMatch(/dev/);
  });

  it('sin aviso con MP_ENTORNO válido o sin Mercado Pago configurado', () => {
    expect(avisoEntornoPagos({ MP_ACCESS_TOKEN: 'x', MP_ENTORNO: 'prod' })).toBeNull();
    expect(avisoEntornoPagos({ NODE_ENV: 'production' })).toBeNull();
  });
});

describe('Referencias nuevas con prefijo', () => {
  it('pedido: "<entorno>-<id>"; cita: "<entorno>-cita-<id>"', () => {
    expect(referenciaPedido(3101, 'dev')).toBe('dev-3101');
    expect(referenciaPedido(3101, 'prod')).toBe('prod-3101');
    expect(referenciaCitaPago(25, 'dev')).toBe('dev-cita-25');
    expect(referenciaCitaPago(25, 'prod')).toBe('prod-cita-25');
  });
});

describe('Leer la referencia de un aviso de pago', () => {
  it('con el prefijo de su propio entorno: se aplica', () => {
    expect(leerReferencia('dev-3101', 'dev')).toEqual({ tipo: 'pedido', id: 3101, origen: 'propio' });
    expect(leerReferencia('prod-cita-25', 'prod')).toEqual({ tipo: 'cita', id: 25, origen: 'propio' });
  });

  it('con el prefijo de OTRO entorno: se marca para rechazarla (una prueba local no toca producción)', () => {
    expect(leerReferencia('dev-3089', 'prod')).toEqual({ tipo: 'pedido', id: 3089, origen: 'otro_entorno' });
    expect(leerReferencia('prod-cita-7', 'dev')).toEqual({ tipo: 'cita', id: 7, origen: 'otro_entorno' });
  });

  it('sin prefijo (ya emitidas antes del cambio, también las de la app): siguen valiendo, marcadas como antiguas', () => {
    expect(leerReferencia('3089', 'prod')).toEqual({ tipo: 'pedido', id: 3089, origen: 'sin_prefijo' });
    expect(leerReferencia('cita-12', 'prod')).toEqual({ tipo: 'cita', id: 12, origen: 'sin_prefijo' });
  });

  it.each([null, undefined, '', 'abc', '0', 'dev-0', '-5', 'cita-', 'qa-12', 'dev-cita-x', '12.5', 'dev-99999999999999999999'])(
    'referencia inválida %p: null',
    (ref) => {
      expect(leerReferencia(ref as string | null, 'dev')).toBeNull();
    },
  );
});

describe('Búsqueda en Mercado Pago (verificación activa)', () => {
  it('busca primero la referencia nueva y después la antigua sin prefijo (preferencias creadas antes del cambio)', () => {
    expect(referenciasDeBusqueda('pedido', 3101, 'dev')).toEqual(['dev-3101', '3101']);
    expect(referenciasDeBusqueda('cita', 25, 'prod')).toEqual(['prod-cita-25', 'cita-25']);
  });
});
