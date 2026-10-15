-- =====================================================================================================
-- PRODUCCIÓN, OLA 2: privacidad y consentimientos, observaciones y cambio de correo, revocación de compra y
-- quién registró cada consentimiento (consentimientos.registrado_por_id).
-- Archivo de entrega SIN APLICAR. Lo aplica Angel en el SQL Editor de Neon de PRODUCCIÓN.
--
-- CUÁNDO: ANTES del deploy del backend de esta ola. El cliente Prisma nuevo lee devoluciones.origen y las
-- tablas nuevas: un backend desplegado antes que este SQL falla en cualquier consulta de devoluciones.
--
-- PASO 0, ANTES de este archivo: 20261014120000_producto_activo es de este mismo paquete y va primero, sola.
--   Aplica en el SQL Editor el contenido de prisma/migrations/20261014120000_producto_activo/migration.sql y,
--   cuando termine bien, márcala (con el .env de producción, desde la carpeta del backend):
--   npx prisma migrate resolve --applied 20261014120000_producto_activo
--   La comprobación previa de este archivo detiene todo si falta.
--
-- ORDEN (ya viene así en este archivo; todo va en UNA transacción: si algo falla, no queda nada a medias):
--   0. Comprobación previa: que 20261014120000_producto_activo ya esté aplicada (paso 0 de arriba).
--   1. 20261014130000_privacidad_y_consentimientos
--   2. 20261014140000_observaciones_y_cambio_correo
--   3. 20261014150000_revocacion_compra
--   4. 20261014160000_consentimiento_registrado_por
--
-- DESPUÉS de que el COMMIT termine bien, marca las cuatro como aplicadas (en este orden, con el .env de
-- producción, desde la carpeta del backend):
--   npx prisma migrate resolve --applied 20261014130000_privacidad_y_consentimientos
--   npx prisma migrate resolve --applied 20261014140000_observaciones_y_cambio_correo
--   npx prisma migrate resolve --applied 20261014150000_revocacion_compra
--   npx prisma migrate resolve --applied 20261014160000_consentimiento_registrado_por
--
-- Solo aditivo: crea tablas, una secuencia, dos funciones, triggers, una columna con default y otra que admite
-- NULL con su índice y su llave foránea; no modifica ni borra datos existentes. consentimientos y
-- versiones_documentos_legales quedan de SOLO INSERCIÓN.
-- El contenido de cada bloque es idéntico al migration.sql de su carpeta en prisma/migrations/.
-- =====================================================================================================

BEGIN;

-- 0. Comprobación previa (solo lectura).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'productos' AND column_name = 'activo'
  ) THEN
    RAISE EXCEPTION 'Falta aplicar 20261014120000_producto_activo antes de este archivo';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 1. 20261014130000_privacidad_y_consentimientos
-- -----------------------------------------------------------------------------------------------------
-- Privacidad y consentimientos: evidencia de cada consentimiento (consentimientos), versiones publicadas de
-- los documentos legales (versiones_documentos_legales) y solicitudes de derechos ARCO (solicitudes_arco,
-- con folio ARCO-AAAA-000001). Va DESPUÉS de 20261014120000_producto_activo.
-- consentimientos y versiones_documentos_legales son de SOLO INSERCIÓN: triggers rechazan UPDATE, DELETE y
-- TRUNCATE (revocar un consentimiento o publicar una versión nueva es insertar otra fila).
-- Siembra las 5 versiones vigentes del registro src/app/utils/documentosLegales.ts de la web, con el hash de
-- node scripts/hash-documentos-legales.mjs (anticipos vive en la página de reembolsos: comparte su hash).
-- Solo aditiva: crea tablas, una secuencia y dos funciones; no modifica ni borra datos existentes.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014130000_privacidad_y_consentimientos

-- Evidencia legal de solo inserción: rechaza modificar, borrar o vaciar la tabla.
CREATE FUNCTION "rechazar_cambios_solo_insercion"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción (evidencia legal): no se permite %. Registra el cambio como una fila nueva.',
    TG_TABLE_NAME,
    CASE TG_OP WHEN 'UPDATE' THEN 'modificar filas' WHEN 'DELETE' THEN 'borrar filas' ELSE 'vaciarla' END;
END;
$$;

-- CreateTable
CREATE TABLE "consentimientos" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" TEXT,
    "visitante_id" TEXT,
    "tipo" TEXT NOT NULL,
    "documento_slug" TEXT,
    "documento_version" TEXT,
    "documento_hash" TEXT,
    "accion" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "ip" TEXT,
    "user_agent" TEXT,
    "formulario" TEXT NOT NULL,
    "ruta_origen" TEXT,
    "metodo" TEXT NOT NULL DEFAULT 'casilla_marcada',

    CONSTRAINT "consentimientos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consentimientos_tipo_check" CHECK ("tipo" IN (
      'terminos', 'aviso_privacidad', 'promociones', 'datos_salud', 'terminos_venta',
      'reembolsos', 'anticipos', 'fotos_resultado', 'cookies'
    )),
    CONSTRAINT "consentimientos_accion_check" CHECK ("accion" IN ('aceptado', 'revocado')),
    -- Todo consentimiento tiene titular: una cuenta o un visitante sin sesión.
    CONSTRAINT "consentimientos_titular_check" CHECK ("usuario_id" IS NOT NULL OR "visitante_id" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "consentimientos_usuario_id_idx" ON "consentimientos"("usuario_id");

-- CreateIndex
CREATE INDEX "consentimientos_visitante_id_idx" ON "consentimientos"("visitante_id");

-- CreateIndex
CREATE INDEX "consentimientos_tipo_creado_en_idx" ON "consentimientos"("tipo", "creado_en");

-- AddForeignKey
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo inserción
CREATE TRIGGER "consentimientos_solo_insercion"
  BEFORE UPDATE OR DELETE ON "consentimientos"
  FOR EACH ROW EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

CREATE TRIGGER "consentimientos_sin_truncate"
  BEFORE TRUNCATE ON "consentimientos"
  FOR EACH STATEMENT EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

-- CreateTable
CREATE TABLE "versiones_documentos_legales" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "hash_texto" TEXT NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "versiones_documentos_legales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "versiones_documentos_legales_slug_version_key" ON "versiones_documentos_legales"("slug", "version");

-- Solo inserción
CREATE TRIGGER "versiones_documentos_legales_solo_insercion"
  BEFORE UPDATE OR DELETE ON "versiones_documentos_legales"
  FOR EACH ROW EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

CREATE TRIGGER "versiones_documentos_legales_sin_truncate"
  BEFORE TRUNCATE ON "versiones_documentos_legales"
  FOR EACH STATEMENT EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

-- Versiones vigentes desde el 14 de octubre de 2026 (registro documentosLegales.ts de la web).
INSERT INTO "versiones_documentos_legales" ("slug", "version", "hash_texto", "vigente_desde") VALUES
  ('terminos', '2.0', '6105ab7970cb21bbc1f8c629bd7da5a9952061cbc83741c5eced5ea68d1b4d69', DATE '2026-10-14'),
  ('aviso-privacidad', '2.0', 'fae1b55c1fc51ab41088fdfdf8bb1ab4a84ad7a9eeca1d050e88cb1d100ef1bd', DATE '2026-10-14'),
  ('cookies', '1.0', '48a413af84c7421848e67d8cecb4adae5fdcfb020157a62c999e6e96c4c5d083', DATE '2026-10-14'),
  ('reembolsos', '1.0', '33d032da7e2d870da8b370b0017ed4b78454964315ec355fe1b4f1d1ad892bf5', DATE '2026-10-14'),
  ('anticipos', '1.0', '33d032da7e2d870da8b370b0017ed4b78454964315ec355fe1b4f1d1ad892bf5', DATE '2026-10-14');

-- Folio de las solicitudes ARCO: ARCO-AAAA-000001 (año de recepción en hora de México y consecutivo de la
-- secuencia; el consecutivo no se reinicia cada año y crece a 7 dígitos después de 999999 sin repetirse).
CREATE SEQUENCE "solicitudes_arco_folio_seq";

CREATE FUNCTION "siguiente_folio_arco"() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT := nextval('solicitudes_arco_folio_seq');
BEGIN
  RETURN 'ARCO-' || to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY') || '-'
    || lpad(n::TEXT, GREATEST(6, length(n::TEXT)), '0');
END;
$$;

-- CreateTable
CREATE TABLE "solicitudes_arco" (
    "id" SERIAL NOT NULL,
    "folio" TEXT NOT NULL DEFAULT "siguiente_folio_arco"(),
    "usuario_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'recibida',
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "vence_respuesta" TIMESTAMPTZ(6) NOT NULL,
    "respuesta" TEXT,
    "respondida_en" TIMESTAMPTZ(6),
    "vence_efectividad" TIMESTAMPTZ(6),
    "atendida_en" TIMESTAMPTZ(6),
    "atendida_por_id" TEXT,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "solicitudes_arco_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "solicitudes_arco_tipo_check" CHECK ("tipo" IN ('acceso', 'rectificacion', 'cancelacion', 'oposicion', 'revocacion')),
    CONSTRAINT "solicitudes_arco_estado_check" CHECK ("estado" IN ('recibida', 'en_proceso', 'respondida', 'atendida', 'rechazada'))
);

ALTER SEQUENCE "solicitudes_arco_folio_seq" OWNED BY "solicitudes_arco"."folio";

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_arco_folio_key" ON "solicitudes_arco"("folio");

-- CreateIndex
CREATE INDEX "solicitudes_arco_usuario_id_idx" ON "solicitudes_arco"("usuario_id");

-- CreateIndex
CREATE INDEX "solicitudes_arco_estado_vence_respuesta_idx" ON "solicitudes_arco"("estado", "vence_respuesta");

-- AddForeignKey
ALTER TABLE "solicitudes_arco" ADD CONSTRAINT "solicitudes_arco_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_arco" ADD CONSTRAINT "solicitudes_arco_atendida_por_id_fkey" FOREIGN KEY ("atendida_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------------------------------
-- 2. 20261014140000_observaciones_y_cambio_correo
-- -----------------------------------------------------------------------------------------------------
-- Observaciones del personal sobre una clienta (observaciones_cliente) y cambio de correo verificado con un
-- código (solicitudes_cambio_correo: solo se guarda el hash del código, nunca el código).
-- Va DESPUÉS de 20261014130000_privacidad_y_consentimientos.
-- Solo aditiva: crea dos tablas; no modifica ni borra datos existentes.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014140000_observaciones_y_cambio_correo

-- CreateTable
CREATE TABLE "observaciones_cliente" (
    "id" SERIAL NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "autor_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "observaciones_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_cambio_correo" (
    "id" SERIAL NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "correo_nuevo" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "usado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "solicitudes_cambio_correo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observaciones_cliente_cliente_id_idx" ON "observaciones_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "solicitudes_cambio_correo_usuario_id_idx" ON "solicitudes_cambio_correo"("usuario_id");

-- AddForeignKey
ALTER TABLE "observaciones_cliente" ADD CONSTRAINT "observaciones_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observaciones_cliente" ADD CONSTRAINT "observaciones_cliente_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_correo" ADD CONSTRAINT "solicitudes_cambio_correo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------------------------------
-- 3. 20261014150000_revocacion_compra
-- -----------------------------------------------------------------------------------------------------
-- Revocación de compra (art. 56 de la Ley Federal de Protección al Consumidor): marca en devoluciones las que
-- vienen de una revocación dentro de los 5 días hábiles (origen = 'revocacion_art56'); las demás son
-- solicitudes de cambio o reembolso por la política de devoluciones (origen = 'solicitud').
-- La fecha de entrega NO lleva columna: sale del historial (historial_estados_pedido con estado_nuevo =
-- 'entregado', que registran todas las entregas) y, si no se ha entregado, el plazo corre desde pedidos.pagado_en.
-- Va DESPUÉS de 20261014140000_observaciones_y_cambio_correo.
-- Solo aditiva: agrega una columna con default; las devoluciones existentes quedan en 'solicitud'.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014150000_revocacion_compra

-- AlterTable
ALTER TABLE "devoluciones" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'solicitud';

ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_origen_check" CHECK ("origen" IN ('solicitud', 'revocacion_art56'));

-- -----------------------------------------------------------------------------------------------------
-- 4. 20261014160000_consentimiento_registrado_por
-- -----------------------------------------------------------------------------------------------------
-- Consentimientos capturados por el personal: registrado_por_id guarda quién registró la fila cuando no fue la
-- titular (el admin al dar de alta una cuenta o al capturar datos de salud en la ficha, o el personal al
-- revocar promociones). Queda NULL cuando la registró la propia titular o un visitante.
-- Va DESPUÉS de 20261014150000_revocacion_compra.
-- consentimientos es de SOLO INSERCIÓN (su trigger rechaza UPDATE): la llave foránea no lleva ninguna acción que
-- modifique filas (ON DELETE RESTRICT y ON UPDATE RESTRICT). Mismo tipo que usuarios.id (TEXT con el uuid).
-- Solo aditiva: agrega una columna que admite NULL, su índice y su llave foránea; no modifica ni borra datos.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014160000_consentimiento_registrado_por

-- AlterTable
ALTER TABLE "consentimientos" ADD COLUMN "registrado_por_id" TEXT;

-- CreateIndex
CREATE INDEX "consentimientos_registrado_por_id_idx" ON "consentimientos"("registrado_por_id");

-- AddForeignKey
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;

-- Recuerda: después del COMMIT, los cuatro npx prisma migrate resolve --applied de arriba (la de producto activo
-- ya quedó marcada en el paso 0), y luego el deploy del backend.
