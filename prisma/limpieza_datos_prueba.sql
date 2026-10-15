-- Limpieza de datos de prueba (QA, diagnóstico y demo) que quedaron en la base.
--
-- REGLA AUTORIZADA: se DESACTIVA lo que tiene columna activo o de estado; se BORRA solo lo que no
-- tiene relaciones con dinero, pedidos, citas ni pagos. Nunca se tocan las cuentas del dueño, las
-- cuentas @example.com ni las cuentas Auditoría. Nada se busca por correo.
--
-- EL MISMO ARCHIVO sirve para desarrollo (ya aplicado) y para producción (se aplica en el SQL Editor
-- de Neon). NINGUNA sentencia depende solo de ids: cada una exige además una condición que confirma que
-- la fila es de prueba (contenido, estado, cuenta de prueba). Lo que no exista o ya esté limpio afecta
-- 0 filas, y volver a ejecutarlo no cambia nada.
--
-- SEGURIDAD EN PRODUCCIÓN: antes del COMMIT, el bloque DO del final revisa cada id de este archivo. Si
-- una fila con ese id existe y NO cumple su condición de prueba (por ejemplo, en producción el pedido 64
-- es de una clienta real o ya se pagó), lanza un error y TODO se revierte: no se toca nada.
--
-- Cuenta de prueba del dueño: id 297a06b5-0ec2-4e38-9b11-faf19135c176 (rol cliente; dueña del pedido 64
-- y de las citas sintéticas 3562 y 3798). Sus pedidos y citas de prueba se limpian; la cuenta nunca se
-- desactiva.
--
-- Filas afectadas en DESARROLLO (rama ep-mute-rice) la primera vez, en orden:
--   1 paquetes 22 | 2 servicios 0 (ya inactivos) | 3 proveedores 0 (ya inactivos) | 4 quejas 2
--   5 factura 1 | 6 demo_truncate (DROP) | 7 usuarias 4 | 8 seguimiento 1 | 9 cita 12 1
--   10 pedidos 65 a 71: 7 | 11 pedido 64: 1 | 12 citas 3562 y 3798: 0 (completada y cancelada)
--   13 presentaciones 204 y 205: 2
-- Volver a correrlo hoy en desarrollo: 0 filas en todas las sentencias y el bloque DO no aborta
-- (verificado con COMMIT cambiado por ROLLBACK).
-- Esperado en PRODUCCIÓN (según los SELECT ya hechos allá): paquetes hasta 22, servicios 1 (solo el
-- 96 existe), proveedores 0 (ZZ Diag solo existe en desarrollo), y el resto según su estado actual.

BEGIN;

-- 1) Paquetes de prueba 6 a 23, 28 a 30 y 32. La tabla paquetes NO tiene columna activo, así que se
--    borran, pero solo los que ninguna cotización referencia (cotizaciones.paquete_id es RESTRICT).
--    Prueba: precio simbólico (los de QA costaban unos $30; los reales, como el 5 y el 31, $1,100).
DELETE FROM paquetes
WHERE id IN (6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,28,29,30,32)
  AND precio_especial < 100
  AND NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE c.paquete_id = paquetes.id);

-- 2) Servicios de QA y diagnóstico: se desactivan (tienen citas y ventas posibles; no se borran).
--    Prueba: el nombre ('Servicio QA ...' o 'ZZ Diag ...').
UPDATE servicios SET activo = false
WHERE id IN (96, 97, 98)
  AND (nombre ILIKE '%QA%' OR nombre ILIKE 'ZZ Diag%')
  AND activo = true;

-- 3) Proveedores "ZZ Diag" (diagnóstico): se desactivan. En producción afecta 0 filas.
UPDATE proveedores SET activo = false WHERE nombre LIKE 'ZZ Diag%' AND activo = true;

-- 4) Quejas 1 y 2 de QA: ninguna tabla las referencia por llave foránea; tampoco se borran si alguna
--    notificación apunta a ellas (entidad_tipo queja). Prueba: dicen QA o son de una cuenta de prueba.
DELETE FROM quejas
WHERE id IN (1, 2)
  AND (
    asunto ILIKE '%QA%'
    OR descripcion ILIKE '%QA%'
    OR usuario_id = '297a06b5-0ec2-4e38-9b11-faf19135c176'
    OR usuario_id IN (SELECT u.id FROM usuarios u WHERE u.nombre IN ('User', 'Bountyrush', 'Cliente Alexa', 'mishu') AND u.rol = 'cliente')
  )
  AND NOT EXISTS (
    SELECT 1 FROM notificaciones n
    WHERE n.entidad_tipo ILIKE 'queja%' AND n.entidad_id = quejas.id::text
  );

-- 5) Factura 3: no se borra. Su estado 'perfect' no existe en el dominio (texto libre en el backend;
--    los valores que usan el panel de facturación y el portal son solicitada, timbrada, emitida y
--    cancelada). Se corrige a 'solicitada', el más conservador: es el estado inicial del flujo, no
--    afirma que se timbró, emitió ni canceló nada, y caja la puede pasar a 'timbrada' desde el panel
--    si de verdad lo está (tiene folio y UUID, así que la regla de facturas lo permite).
--    Prueba: el estado inexistente y que es de un pedido demo de la predicción.
UPDATE facturas SET estado = 'solicitada'
WHERE id = 3
  AND estado = 'perfect'
  AND pedido_id IN (SELECT p.id FROM pedidos p WHERE p.metodo_pago = 'seed_demo_prediccion');

-- 6) Tabla de demostración que no está en el schema de Prisma ni la usa el código.
DROP TABLE IF EXISTS demo_truncate;

-- 7) Clientas de prueba: se DESACTIVAN (activo = false), no se borran: tienen pedidos, citas o ventas.
--    Se buscan por nombre exacto Y rol cliente (nunca por correo). Exclusiones explícitas: la cuenta
--    del dueño, las @example.com y las Auditoría. Es reversible (activo = true). Una cuenta inactiva no
--    puede iniciar sesión: Cliente Alexa dejará de poder entrar. Si algún nombre está repetido (podría
--    ser una clienta real), el bloque DO del final aborta todo.
UPDATE usuarios SET activo = false
WHERE nombre IN ('User', 'Bountyrush', 'Cliente Alexa', 'mishu')
  AND rol = 'cliente'
  AND id <> '297a06b5-0ec2-4e38-9b11-faf19135c176'
  AND email NOT ILIKE '%@example.com'
  AND nombre NOT ILIKE 'Auditor%'
  AND activo = true;

-- 8) Seguimiento 1 de QA: sale de la cola de pendientes (requiere_accion = false). No se borra.
--    Prueba: su nota dice QA.
UPDATE seguimientos_post_servicio SET requiere_accion = false
WHERE id = 1 AND notas ILIKE '%QA%' AND requiere_accion = true;

-- 9) Cita 12: se quita la nota de QA (solo si la nota es de QA).
UPDATE citas SET notas = NULL WHERE id = 12 AND notas ILIKE '%QA%';

-- 10) Pedidos demo de la predicción (65 a 71): estado cancelado. Prueba: metodo_pago
--     seed_demo_prediccion y ningún pago. No se tocan stock, pagos ni historial: es un cambio de estado
--     directo de datos de prueba.
UPDATE pedidos SET estado = 'cancelado'
WHERE id BETWEEN 65 AND 71
  AND metodo_pago = 'seed_demo_prediccion'
  AND NOT EXISTS (SELECT 1 FROM pagos g WHERE g.pedido_id = pedidos.id)
  AND estado <> 'cancelado';

-- 11) Pedido 64 de prueba: estado cancelado (su pago pendiente se queda como está). Prueba: es de la
--     cuenta de prueba del dueño, nunca se pagó (borrador o pendiente de pago) y no tiene ningún pago
--     aprobado, en revisión ni reembolsado. Un pedido pagado o entregado nunca se cancela aquí.
UPDATE pedidos SET estado = 'cancelado'
WHERE id = 64
  AND usuario_id = '297a06b5-0ec2-4e38-9b11-faf19135c176'
  AND estado IN ('borrador', 'pendiente_pago')
  AND NOT EXISTS (
    SELECT 1 FROM pagos g WHERE g.pedido_id = pedidos.id AND g.estado IN ('aprobado', 'en_revision', 'reembolsado')
  );

-- 12) Citas de prueba 3562 y 3798: cancelada SOLO si siguen vivas (estados que ocupan horario en
--     citas.service: pendiente, confirmada, reprogramada, en_curso). Una completada no se toca.
--     Prueba: son citas históricas sintéticas (su nota) de la cuenta de prueba del dueño.
UPDATE citas SET estado = 'cancelada'
WHERE id IN (3562, 3798)
  AND notas ILIKE 'Cita histórica sintética%'
  AND cliente_id = '297a06b5-0ec2-4e38-9b11-faf19135c176'
  AND estado IN ('pendiente', 'confirmada', 'reprogramada', 'en_curso');

-- 13) Presentaciones de prueba 204 y 205 con precio 0: dejan de estar disponibles (no se borran).
UPDATE producto_presentaciones SET disponible = false WHERE id IN (204, 205) AND precio = 0 AND disponible = true;

-- Guardia de producción: si alguna fila con estos ids existe y NO es de prueba, aborta todo (el error
-- revierte la transacción completa). Acepta el estado ya limpio, así que volver a correrlo no aborta.
DO $$
DECLARE
  cuenta_dueno CONSTANT text := '297a06b5-0ec2-4e38-9b11-faf19135c176';
  ids text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO ids FROM paquetes
  WHERE id IN (6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,28,29,30,32)
    AND NOT (precio_especial < 100);
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: los paquetes % no parecen de prueba (precio real).', ids; END IF;

  SELECT string_agg(id::text, ', ') INTO ids FROM servicios
  WHERE id IN (96, 97, 98) AND NOT (nombre ILIKE '%QA%' OR nombre ILIKE 'ZZ Diag%');
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: los servicios % no son de QA ni de diagnóstico.', ids; END IF;

  SELECT string_agg(id::text, ', ') INTO ids FROM quejas q
  WHERE q.id IN (1, 2)
    AND NOT (
      q.asunto ILIKE '%QA%' OR q.descripcion ILIKE '%QA%' OR q.usuario_id = cuenta_dueno
      OR q.usuario_id IN (SELECT u.id FROM usuarios u WHERE u.nombre IN ('User', 'Bountyrush', 'Cliente Alexa', 'mishu') AND u.rol = 'cliente')
    );
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: las quejas % no son de QA (podrían ser de una clienta real).', ids; END IF;

  IF EXISTS (
    SELECT 1 FROM facturas f
    WHERE f.id = 3
      AND NOT (f.estado IN ('perfect', 'solicitada') AND f.pedido_id IN (SELECT p.id FROM pedidos p WHERE p.metodo_pago = 'seed_demo_prediccion'))
  ) THEN
    RAISE EXCEPTION 'Limpieza abortada: la factura 3 no es la de prueba (pedido demo con estado perfect o solicitada).';
  END IF;

  SELECT string_agg(nombre, ', ') INTO ids FROM (
    SELECT nombre FROM usuarios
    WHERE nombre IN ('User', 'Bountyrush', 'Cliente Alexa', 'mishu')
      AND rol = 'cliente' AND id <> cuenta_dueno AND email NOT ILIKE '%@example.com' AND nombre NOT ILIKE 'Auditor%'
    GROUP BY nombre HAVING count(*) > 1
  ) repetidos;
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: hay más de una cuenta llamada % (podría ser una clienta real).', ids; END IF;

  -- Una cuenta con esos nombres que ya pagó algo (pedido o anticipo de cita) es una clienta real, no de prueba.
  SELECT string_agg(DISTINCT u.nombre, ', ') INTO ids FROM usuarios u
  WHERE u.nombre IN ('User', 'Bountyrush', 'Cliente Alexa', 'mishu') AND u.rol = 'cliente' AND u.id <> cuenta_dueno
    AND EXISTS (
      SELECT 1 FROM pagos pg
      LEFT JOIN pedidos pe ON pe.id = pg.pedido_id
      LEFT JOIN citas ci ON ci.id = pg.cita_id
      WHERE pg.estado = 'aprobado' AND (pe.usuario_id = u.id OR ci.cliente_id = u.id)
    );
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: la cuenta % tiene pagos aprobados (podría ser una clienta real).', ids; END IF;

  IF EXISTS (SELECT 1 FROM seguimientos_post_servicio WHERE id = 1 AND (notas IS NULL OR notas NOT ILIKE '%QA%')) THEN
    RAISE EXCEPTION 'Limpieza abortada: el seguimiento 1 no es de QA.';
  END IF;

  IF EXISTS (SELECT 1 FROM citas WHERE id = 12 AND notas IS NOT NULL AND notas NOT ILIKE '%QA%') THEN
    RAISE EXCEPTION 'Limpieza abortada: la cita 12 tiene una nota que no es de QA.';
  END IF;

  SELECT string_agg(id::text, ', ') INTO ids FROM pedidos
  WHERE id BETWEEN 65 AND 71 AND (metodo_pago IS DISTINCT FROM 'seed_demo_prediccion' OR EXISTS (SELECT 1 FROM pagos g WHERE g.pedido_id = pedidos.id));
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: los pedidos % no son demo de la predicción.', ids; END IF;

  IF EXISTS (
    SELECT 1 FROM pedidos p
    WHERE p.id = 64
      AND NOT (
        p.usuario_id = cuenta_dueno
        AND p.estado IN ('borrador', 'pendiente_pago', 'cancelado')
        AND NOT EXISTS (SELECT 1 FROM pagos g WHERE g.pedido_id = p.id AND g.estado IN ('aprobado', 'en_revision', 'reembolsado'))
      )
  ) THEN
    RAISE EXCEPTION 'Limpieza abortada: el pedido 64 no es el de prueba (otra clienta, pagado, entregado o con pago aprobado).';
  END IF;

  SELECT string_agg(id::text, ', ') INTO ids FROM citas
  WHERE id IN (3562, 3798)
    AND NOT (notas ILIKE 'Cita histórica sintética%' AND cliente_id = cuenta_dueno);
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: las citas % no son las sintéticas de prueba.', ids; END IF;

  SELECT string_agg(id::text, ', ') INTO ids FROM producto_presentaciones WHERE id IN (204, 205) AND precio <> 0;
  IF ids IS NOT NULL THEN RAISE EXCEPTION 'Limpieza abortada: las presentaciones % tienen precio (no son de prueba).', ids; END IF;
END $$;

COMMIT;
