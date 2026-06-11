-- Seed de movimientos de inventario para frontend (predicción)
-- Objetivo: productos 2, 3 y 4 con ~114 movimientos totales en últimos 90 días.
-- Requisitos cubiertos:
-- - Salidas: pedido_creado, pedido_item_creado, pedido_item_cantidad_incrementada, pedido_reactivado
-- - Entradas: pedido_item_cantidad_reducida, pedido_item_eliminado, pedido_cancelado
-- - Ajustes manuales: tipo=ajuste
-- - stock_antes / stock_despues consistentes
-- - sin stock negativo
-- - referencia_tipo / referencia_id / motivo / creado_en poblados
--
-- Ejecuta este script en PostgreSQL:
--   psql "$DATABASE_URL" -f scripts/seed_inventario_movimientos.sql

BEGIN;

DO $$
DECLARE
  target_product_id INT;
  target_presentacion_id INT;
  actor_id TEXT;
  admin_id TEXT;
  curr_stock INT;
  qty INT;
  delta INT;
  before_stock INT;
  after_stock INT;
  seq_no INT;
  ev RECORD;
BEGIN
  -- Usuario actor para asociar movimientos.
  SELECT id INTO admin_id
  FROM usuarios
  WHERE rol = 'admin'
  ORDER BY creado_en ASC
  LIMIT 1;

  SELECT COALESCE(admin_id, (SELECT id FROM usuarios ORDER BY creado_en ASC LIMIT 1))
  INTO actor_id;

  -- Plantilla de eventos por producto:
  -- 24 salidas + 10 entradas + 4 ajustes = 38 por producto (114 total).
  CREATE TEMP TABLE tmp_inv_eventos (
    seq INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    day_offset INT NOT NULL,
    tipo TEXT NOT NULL,           -- entrada | salida | ajuste
    direction SMALLINT NOT NULL,  -- +1 incrementa, -1 decrementa
    motivo TEXT NOT NULL,
    referencia_tipo TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_inv_eventos (day_offset, tipo, direction, motivo, referencia_tipo) VALUES
  -- ajustes (4)
  (90, 'ajuste',  1, 'ajuste_manual_alza',  'ajuste_manual'),
  (64, 'ajuste', -1, 'ajuste_manual_baja',  'ajuste_manual'),
  (33, 'ajuste',  1, 'ajuste_manual_alza',  'ajuste_manual'),
  (5,  'ajuste', -1, 'ajuste_manual_baja',  'ajuste_manual'),

  -- entradas (10)
  (84, 'entrada', 1, 'pedido_item_cantidad_reducida', 'pedido_item'),
  (71, 'entrada', 1, 'pedido_item_eliminado',         'pedido_item'),
  (60, 'entrada', 1, 'pedido_cancelado',              'pedido'),
  (49, 'entrada', 1, 'pedido_item_cantidad_reducida', 'pedido_item'),
  (40, 'entrada', 1, 'pedido_item_eliminado',         'pedido_item'),
  (29, 'entrada', 1, 'pedido_cancelado',              'pedido'),
  (20, 'entrada', 1, 'pedido_item_cantidad_reducida', 'pedido_item'),
  (12, 'entrada', 1, 'pedido_item_eliminado',         'pedido_item'),
  (8,  'entrada', 1, 'pedido_cancelado',              'pedido'),
  (3,  'entrada', 1, 'pedido_item_cantidad_reducida', 'pedido_item'),

  -- salidas (24)
  (88, 'salida', -1, 'pedido_creado',                     'pedido'),
  (85, 'salida', -1, 'pedido_item_creado',                'pedido_item'),
  (83, 'salida', -1, 'pedido_item_cantidad_incrementada', 'pedido_item'),
  (79, 'salida', -1, 'pedido_reactivado',                 'pedido'),
  (76, 'salida', -1, 'pedido_creado',                     'pedido'),
  (73, 'salida', -1, 'pedido_item_creado',                'pedido_item'),
  (69, 'salida', -1, 'pedido_item_cantidad_incrementada', 'pedido_item'),
  (66, 'salida', -1, 'pedido_reactivado',                 'pedido'),
  (62, 'salida', -1, 'pedido_creado',                     'pedido'),
  (58, 'salida', -1, 'pedido_item_creado',                'pedido_item'),
  (54, 'salida', -1, 'pedido_item_cantidad_incrementada', 'pedido_item'),
  (51, 'salida', -1, 'pedido_reactivado',                 'pedido'),
  (47, 'salida', -1, 'pedido_creado',                     'pedido'),
  (43, 'salida', -1, 'pedido_item_creado',                'pedido_item'),
  (39, 'salida', -1, 'pedido_item_cantidad_incrementada', 'pedido_item'),
  (35, 'salida', -1, 'pedido_reactivado',                 'pedido'),
  (31, 'salida', -1, 'pedido_creado',                     'pedido'),
  (27, 'salida', -1, 'pedido_item_creado',                'pedido_item'),
  (22, 'salida', -1, 'pedido_item_cantidad_incrementada', 'pedido_item'),
  (18, 'salida', -1, 'pedido_reactivado',                 'pedido'),
  (14, 'salida', -1, 'pedido_creado',                     'pedido'),
  (14, 'salida', -1, 'pedido_item_creado',                'pedido_item'), -- día pico
  (6,  'salida', -1, 'pedido_item_cantidad_incrementada', 'pedido_item'),
  (2,  'salida', -1, 'pedido_reactivado',                 'pedido');

  FOR target_product_id IN 2..4 LOOP
    -- Escoge 1 presentación por producto (la de menor id) para concentrar historial útil en gráficas.
    SELECT id INTO target_presentacion_id
    FROM producto_presentaciones
    WHERE producto_id = target_product_id
    ORDER BY id ASC
    LIMIT 1;

    IF target_presentacion_id IS NULL THEN
      RAISE NOTICE 'Producto % no tiene presentaciones; se omite.', target_product_id;
      CONTINUE;
    END IF;

    -- Partimos de un stock base seguro para evitar negativos y lograr distribución útil.
    SELECT GREATEST(stock, 85) INTO curr_stock
    FROM producto_presentaciones
    WHERE id = target_presentacion_id;

    UPDATE producto_presentaciones
    SET stock = curr_stock
    WHERE id = target_presentacion_id;

    seq_no := 0;

    FOR ev IN
      SELECT *
      FROM tmp_inv_eventos
      ORDER BY day_offset DESC, seq ASC
    LOOP
      seq_no := seq_no + 1;

      -- Cantidad realista por tipo.
      IF ev.tipo = 'salida' THEN
        qty := 1 + FLOOR(RANDOM() * 5)::INT;       -- 1..5
      ELSIF ev.tipo = 'entrada' THEN
        qty := 1 + FLOOR(RANDOM() * 4)::INT;       -- 1..4
      ELSE
        qty := 1 + FLOOR(RANDOM() * 6)::INT;       -- ajuste 1..6
      END IF;

      -- Si la salida/ajuste-baja excede stock, recorta para mantener stock >= 0.
      IF ev.direction = -1 THEN
        qty := LEAST(qty, curr_stock);
        IF qty <= 0 THEN
          CONTINUE;
        END IF;
      END IF;

      before_stock := curr_stock;
      delta := qty * ev.direction;
      after_stock := before_stock + delta;

      IF after_stock < 0 THEN
        CONTINUE;
      END IF;

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
        ev.tipo::"MovimientoInventarioTipo",
        ev.motivo,
        qty,
        before_stock,
        after_stock,
        ev.referencia_tipo,
        CONCAT('p', target_product_id, '-', ev.referencia_tipo, '-', LPAD(seq_no::TEXT, 3, '0')),
        target_presentacion_id,
        actor_id,
        (
          NOW()
          - MAKE_INTERVAL(days => ev.day_offset)
          + MAKE_INTERVAL(hours => FLOOR(RANDOM() * 10)::INT)
          + MAKE_INTERVAL(mins => FLOOR(RANDOM() * 55)::INT)
        )
      );

      curr_stock := after_stock;
    END LOOP;

    -- Deja el stock actual alineado con el último movimiento insertado.
    UPDATE producto_presentaciones
    SET stock = curr_stock
    WHERE id = target_presentacion_id;

    RAISE NOTICE 'Producto % / presentación % => stock final %', target_product_id, target_presentacion_id, curr_stock;
  END LOOP;
END $$;

COMMIT;
