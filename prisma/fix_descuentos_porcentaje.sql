-- Corrige productos.descuento fuera del rango 0 a 100.
--
-- QUÉ HACE: pone descuento = NULL en los productos cuyo descuento es mayor a 100 o negativo.
--
-- POR QUÉ: productos.descuento es un PORCENTAJE (0 a 100). En 107 de 169 productos guarda un monto
-- en pesos (de 110 a 700 en la rama de desarrollo). La pantalla vieja de edición derivaba el precio de
-- ese "descuento" y daba precios negativos o en cero; la web ya respeta el precio guardado de cada
-- presentación (commit 34c1c54 de miru-franco-web). Los precios reales viven en
-- producto_presentaciones (precio y precio_original) y NO se tocan. Con NULL, la tienda calcula el
-- porcentaje a partir de precio_original y precio de cada presentación. Un descuento negativo tampoco
-- tiene sentido y el DTO ya lo rechaza (@Min(0)).
--
-- FILAS ESPERADAS:
--   - Mayores a 100: 107 (las mismas en producción y en desarrollo; verificado en desarrollo antes de
--     aplicarlo allá).
--   - Negativos: 0 en desarrollo (SELECT de solo lectura del 14 de octubre de 2026, con el script ya
--     aplicado: mayores a 100 = 0, negativos = 0, de 169 productos). En producción, revisar con el
--     SELECT de abajo antes de aplicar.
--
-- CUÁNDO: ANTES del deploy del backend. El DTO nuevo (@Min(0) y @Max(100) en crear y actualizar
-- producto) rechazaría editar esos productos, porque la pantalla de edición reenvía su descuento.
--
-- Se aplica en el SQL Editor de Neon. Es idempotente: volver a correrlo afecta 0 filas. Para revisar antes:
--   SELECT COUNT(*) FILTER (WHERE descuento > 100) AS mayores_100,
--          COUNT(*) FILTER (WHERE descuento < 0)   AS negativos
--   FROM productos;                                  -- mayores_100 debe dar 107
-- Después:
--   SELECT COUNT(*) FROM productos WHERE descuento > 100 OR descuento < 0;   -- debe dar 0

BEGIN;

UPDATE productos SET descuento = NULL WHERE descuento > 100 OR descuento < 0;

-- Comprobación antes de confirmar: no debe quedar ningún descuento fuera de 0 a 100.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM productos WHERE descuento > 100 OR descuento < 0) THEN
    RAISE EXCEPTION 'Quedaron descuentos fuera de 0 a 100: se revierte todo.';
  END IF;
END $$;

COMMIT;
