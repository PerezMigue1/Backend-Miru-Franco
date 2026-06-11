-- Seed principal para submódulo Predicción de inventario (frontend)
-- Fuente de gráficas de consumo: pedidos + pedido_items (NO inventario_movimientos).
--
-- Cubre:
-- - Productos 2, 3 y 4
-- - Estados contables: pagado, preparando, enviado, entregado
-- - Ventana temporal: últimos 90 días (incluye 7 y 30 días)
-- - 54 pedido_items por producto (162 total), en 18 días distintos por producto
-- - Cantidades 1..5
-- - Inserción opcional de inventario_movimientos (salida) para trazabilidad
--
-- Ejecutar:
--   psql "$DATABASE_URL" -f scripts/seed_prediccion_inventario_consumo.sql

BEGIN;

DO $$
DECLARE
  target_product_id INT;
  target_presentacion_id INT;
  target_usuario_id TEXT;
  actor_id TEXT;
  precio_unit NUMERIC(10,2);
  offsets INT[] := ARRAY[1, 2, 3, 5, 6, 7, 9, 12, 15, 18, 22, 26, 31, 37, 45, 56, 69, 84];
  estados TEXT[] := ARRAY['pagado', 'preparando', 'enviado', 'entregado'];
  i INT;
  pedido_id_new INT;
  created_ts TIMESTAMP;
  qty1 INT;
  qty2 INT;
  qty3 INT;
  subtotal_total NUMERIC(10,2);
  sub1 NUMERIC(10,2);
  sub2 NUMERIC(10,2);
  sub3 NUMERIC(10,2);
  ref_base TEXT;
  curr_stock INT;
  stock_before INT;
  stock_after INT;
  pedidos_count INT;
  items_count INT;
BEGIN
  -- Usuario para asociar pedidos (preferimos cliente).
  SELECT id INTO target_usuario_id
  FROM usuarios
  WHERE rol = 'cliente'
  ORDER BY creado_en ASC
  LIMIT 1;

  IF target_usuario_id IS NULL THEN
    SELECT id INTO target_usuario_id
    FROM usuarios
    ORDER BY creado_en ASC
    LIMIT 1;
  END IF;

  IF target_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay usuarios en la base. Crea al menos 1 usuario antes del seed.';
  END IF;

  -- Usuario actor para movimientos (admin si existe; si no, el mismo usuario objetivo).
  SELECT id INTO actor_id
  FROM usuarios
  WHERE rol = 'admin'
  ORDER BY creado_en ASC
  LIMIT 1;
  actor_id := COALESCE(actor_id, target_usuario_id);

  FOR target_product_id IN 2..4 LOOP
    -- Selecciona una presentación por producto (la de menor id) para consolidar serie.
    SELECT id, precio::numeric(10,2), stock
      INTO target_presentacion_id, precio_unit, curr_stock
    FROM producto_presentaciones
    WHERE producto_id = target_product_id
    ORDER BY id ASC
    LIMIT 1;

    IF target_presentacion_id IS NULL THEN
      RAISE EXCEPTION 'Producto % no tiene presentación en producto_presentaciones. Seed abortado.', target_product_id;
    END IF;

    -- Garantiza stock suficiente para no negativos al registrar salidas opcionales.
    curr_stock := GREATEST(curr_stock, 180);
    UPDATE producto_presentaciones
    SET stock = curr_stock
    WHERE id = target_presentacion_id;

    FOR i IN 1..array_length(offsets, 1) LOOP
      created_ts :=
        NOW()
        - MAKE_INTERVAL(days => offsets[i])
        + MAKE_INTERVAL(hours => (i % 6) + 9)   -- horario razonable
        + MAKE_INTERVAL(mins => (i * 7) % 50);

      -- Cantidades 1..5 (deterministas para reproducibilidad).
      qty1 := ((i + target_product_id) % 5) + 1;
      qty2 := ((i + target_product_id + 2) % 5) + 1;
      qty3 := ((i + target_product_id + 4) % 5) + 1;

      sub1 := ROUND(precio_unit * qty1, 2);
      sub2 := ROUND(precio_unit * qty2, 2);
      sub3 := ROUND(precio_unit * qty3, 2);
      subtotal_total := ROUND(sub1 + sub2 + sub3, 2);

      -- Pedido en estado contable.
      INSERT INTO pedidos (
        estado,
        subtotal,
        costo_envio,
        impuestos,
        descuento,
        total,
        moneda,
      notas_cliente,
      referencia_pago,
        usuario_id,
        creado_en,
        actualizado_en
      )
      VALUES (
        estados[((i - 1) % 4) + 1]::"EstadoPedido",
        subtotal_total,
        0,
        0,
        0,
        subtotal_total,
        'MXN',
      CONCAT('seed_prediccion_consumo_p', target_product_id),
      CONCAT('seed-p', target_product_id, '-', TO_CHAR(created_ts, 'YYYYMMDDHH24MI')),
        target_usuario_id,
        created_ts,
        created_ts
      )
      RETURNING id INTO pedido_id_new;

      -- Tres líneas por día => 54 pedido_items por producto en 18 días.
      INSERT INTO pedido_items (
        cantidad,
        precio_unitario,
        subtotal,
        nombre_producto,
        tamanio,
        pedido_id,
        producto_id,
        presentacion_id
      )
      SELECT
        qty1,
        precio_unit,
        sub1,
        p.nombre,
        pp.tamanio,
        pedido_id_new,
        target_product_id,
        target_presentacion_id
      FROM productos p
      JOIN producto_presentaciones pp ON pp.id = target_presentacion_id
      WHERE p.id = target_product_id;

      INSERT INTO pedido_items (
        cantidad,
        precio_unitario,
        subtotal,
        nombre_producto,
        tamanio,
        pedido_id,
        producto_id,
        presentacion_id
      )
      SELECT
        qty2,
        precio_unit,
        sub2,
        p.nombre,
        pp.tamanio,
        pedido_id_new,
        target_product_id,
        target_presentacion_id
      FROM productos p
      JOIN producto_presentaciones pp ON pp.id = target_presentacion_id
      WHERE p.id = target_product_id;

      INSERT INTO pedido_items (
        cantidad,
        precio_unitario,
        subtotal,
        nombre_producto,
        tamanio,
        pedido_id,
        producto_id,
        presentacion_id
      )
      SELECT
        qty3,
        precio_unit,
        sub3,
        p.nombre,
        pp.tamanio,
        pedido_id_new,
        target_product_id,
        target_presentacion_id
      FROM productos p
      JOIN producto_presentaciones pp ON pp.id = target_presentacion_id
      WHERE p.id = target_product_id;

      -- Complementario (opcional): historial de inventario para trazabilidad.
      -- Registro agregado por pedido (salida total = qty1 + qty2 + qty3).
      stock_before := curr_stock;
      stock_after := GREATEST(curr_stock - (qty1 + qty2 + qty3), 0);

      INSERT INTO inventario_movimientos (
        tipo,
        motivo,
        cantidad,
        stock_antes,
        stock_despues,
        referencia_tipo,
        referencia_id,
        presentacion_id,
        usuario_id,
        creado_en
      )
      VALUES (
        'salida'::"MovimientoInventarioTipo",
        'pedido_creado',
        (qty1 + qty2 + qty3),
        stock_before,
        stock_after,
        'pedido',
        CONCAT('seed-consumo-p', target_product_id, '-', pedido_id_new),
        target_presentacion_id,
        actor_id,
        created_ts + INTERVAL '10 minutes'
      );

      curr_stock := stock_after;
    END LOOP;

    UPDATE producto_presentaciones
    SET stock = curr_stock
    WHERE id = target_presentacion_id;

    RAISE NOTICE 'Producto % / presentación %: 54 items en 18 días. Stock final: %',
      target_product_id, target_presentacion_id, curr_stock;

    SELECT COUNT(*)
      INTO pedidos_count
    FROM pedidos
    WHERE notas_cliente = CONCAT('seed_prediccion_consumo_p', target_product_id);

    SELECT COUNT(*)
      INTO items_count
    FROM pedido_items pi
    JOIN pedidos pe ON pe.id = pi.pedido_id
    WHERE pe.notas_cliente = CONCAT('seed_prediccion_consumo_p', target_product_id)
      AND pi.producto_id = target_product_id;

    IF pedidos_count < 18 THEN
      RAISE EXCEPTION 'Validación fallida: producto % tiene % pedidos seed (esperado >= 18).',
        target_product_id, pedidos_count;
    END IF;

    IF items_count < 54 THEN
      RAISE EXCEPTION 'Validación fallida: producto % tiene % pedido_items seed (esperado >= 54).',
        target_product_id, items_count;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verificación rápida post-seed (debe devolver filas para 2,3,4)
SELECT
  pi.producto_id,
  COUNT(DISTINCT pe.id) AS pedidos_seed,
  COUNT(*) AS items_seed,
  MIN(pe.creado_en) AS primer_pedido_seed,
  MAX(pe.creado_en) AS ultimo_pedido_seed
FROM pedido_items pi
JOIN pedidos pe ON pe.id = pi.pedido_id
WHERE pe.notas_cliente LIKE 'seed_prediccion_consumo_p%'
  AND pi.producto_id IN (2,3,4)
GROUP BY pi.producto_id
ORDER BY pi.producto_id;
