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
