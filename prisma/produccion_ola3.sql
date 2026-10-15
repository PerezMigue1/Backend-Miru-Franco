-- =====================================================================================================
-- PRODUCCIÓN, OLA 3: reembolsos pendientes, configuración del sitio (con su historial), contenido público
-- administrable (galería, equipo, promociones y preguntas frecuentes), Política de cookies 1.1 y firmas de
-- subida de imágenes (galería y formularios: solo se registran imágenes subidas desde el panel).
-- Archivo de entrega SIN APLICAR. Se aplica en el SQL Editor de Neon de PRODUCCIÓN.
--
-- CUÁNDO: ANTES del deploy del backend de esta ronda y DESPUÉS de prisma/produccion_ola2.sql (y de sus
-- migrate resolve). El cliente Prisma nuevo lee las tablas nuevas: un backend desplegado antes que este SQL
-- falla en la configuración del sitio, la galería y los reembolsos pendientes.
--
-- ORDEN (ya viene así; todo va en UNA transacción: si algo falla, no queda nada a medias):
--   0. Comprobación previa: que la ola 2 ya esté aplicada.
--   1. 20261016120000_reembolsos_pendientes
--   2. 20261016130000_configuracion_sitio
--   3. 20261016140000_contenido_publico
--   4. 20261016150000_politica_cookies_1_1
--   5. 20261016160000_firmas_subida
--
-- DESPUÉS de que el COMMIT termine bien, marca las cinco como aplicadas (en este orden, con el .env de
-- producción, desde la carpeta del backend):
--   npx prisma migrate resolve --applied 20261016120000_reembolsos_pendientes
--   npx prisma migrate resolve --applied 20261016130000_configuracion_sitio
--   npx prisma migrate resolve --applied 20261016140000_contenido_publico
--   npx prisma migrate resolve --applied 20261016150000_politica_cookies_1_1
--   npx prisma migrate resolve --applied 20261016160000_firmas_subida
--
-- Solo aditivo: crea tablas, columnas con default, índices, llaves foráneas y triggers de solo inserción, y
-- siembra la configuración con los valores que hoy publica el sitio (el horario sale de configuracion_salon de
-- producción) y la galería con las fotos que ya tienen los servicios. Agrega claves de permisos sin pisar las
-- existentes. No modifica ni borra datos existentes.
-- El contenido de cada bloque es idéntico al migration.sql de su carpeta en prisma/migrations/.
-- =====================================================================================================

BEGIN;

-- 0. Comprobación previa (solo lectura): la ola 2 (produccion_ola2.sql) ya está aplicada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'consentimientos' AND column_name = 'registrado_por_id'
  ) OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rechazar_cambios_solo_insercion') THEN
    RAISE EXCEPTION 'Falta aplicar produccion_ola2.sql antes de este archivo';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 1. 20261016120000_reembolsos_pendientes
-- -----------------------------------------------------------------------------------------------------
-- Admin > Reembolsos pendientes: cada reintento y cada reembolso manual de un pago en revisión queda aquí.
-- CreateTable
CREATE TABLE "historial_reembolsos" (
    "id" SERIAL NOT NULL,
    "accion" TEXT NOT NULL,
    "referencia" TEXT,
    "nota" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pago_id" INTEGER NOT NULL,
    "usuario_id" TEXT,

    CONSTRAINT "historial_reembolsos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "historial_reembolsos_accion_check" CHECK ("accion" IN ('reintento', 'reintento_fallido', 'manual'))
);

-- CreateIndex
CREATE INDEX "historial_reembolsos_pago_id_idx" ON "historial_reembolsos"("pago_id");

-- AddForeignKey
ALTER TABLE "historial_reembolsos" ADD CONSTRAINT "historial_reembolsos_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historial_reembolsos" ADD CONSTRAINT "historial_reembolsos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Solo inserción (misma función que consentimientos)
CREATE TRIGGER "historial_reembolsos_solo_insercion"
  BEFORE UPDATE OR DELETE ON "historial_reembolsos"
  FOR EACH ROW EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

CREATE TRIGGER "historial_reembolsos_sin_truncate"
  BEFORE TRUNCATE ON "historial_reembolsos"
  FOR EACH STATEMENT EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

-- -----------------------------------------------------------------------------------------------------
-- 2. 20261016130000_configuracion_sitio
-- -----------------------------------------------------------------------------------------------------
-- Configuración del sitio (Admin > Configuración del sitio) y su historial de cambios.
-- Semilla: los valores que hoy publica el sitio, para que nada cambie al desplegar. El horario sale de la fila de
-- configuracion_salon de cada base (la que usa la agenda); "anticiposDesde" queda en null y el backend sigue usando
-- la variable ANTICIPOS_DESDE como respaldo hasta que se guarde una fecha aquí.

-- CreateTable
CREATE TABLE "configuracion_sitio" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "tipo" TEXT NOT NULL,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_por_id" TEXT,

    CONSTRAINT "configuracion_sitio_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "historial_configuracion_sitio" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "valor_anterior" JSONB,
    "valor_nuevo" JSONB NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_por_id" TEXT,

    CONSTRAINT "historial_configuracion_sitio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historial_configuracion_sitio_clave_creado_en_idx" ON "historial_configuracion_sitio"("clave", "creado_en");

-- AddForeignKey
ALTER TABLE "configuracion_sitio" ADD CONSTRAINT "configuracion_sitio_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "historial_configuracion_sitio" ADD CONSTRAINT "historial_configuracion_sitio_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Historial de solo inserción (misma función que consentimientos)
CREATE TRIGGER "historial_configuracion_sitio_solo_insercion"
  BEFORE UPDATE OR DELETE ON "historial_configuracion_sitio"
  FOR EACH ROW EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

CREATE TRIGGER "historial_configuracion_sitio_sin_truncate"
  BEFORE TRUNCATE ON "historial_configuracion_sitio"
  FOR EACH STATEMENT EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

-- Semilla: datos del salón (los mismos de los Términos, el Aviso y el checkout)
INSERT INTO "configuracion_sitio" ("clave", "tipo", "valor") VALUES
('salon', 'salon', jsonb_build_object(
  'nombre', 'Mirú Franco Salón Beauty',
  'responsable', 'Mildred Rubí Franco Martínez',
  'direccion', 'Segunda Cerrada de Allende No. 15, Col. Juárez',
  'ciudad', 'Huejutla de Reyes, Hidalgo',
  'codigoPostal', '43000',
  'telefono', '+52 771 268 1432',
  'whatsapp', '+52 771 186 7645',
  'correoContacto', 'contacto@mirufranco.com',
  'correoPrivacidad', 'mildredfranco24@gmail.com',
  'mapaUrl', '',
  'lema', 'Salón de belleza profesional dedicado a realzar tu belleza natural con productos y servicios de alta calidad.',
  'descripcionSeo', 'Salón de belleza profesional en Huejutla de Reyes. Cortes, coloración, tratamientos capilares, alaciado y nanoplastía. Agenda tu cita en línea.'
)),
('redes', 'redes', jsonb_build_object('instagram', '', 'facebook', '', 'tiktok', '', 'twitter', '')),
('contenido_inicio', 'contenido', jsonb_build_object(
  'heroTexto', 'Realza tu belleza natural con productos y servicios profesionales. Agenda tu cita y descubre la experiencia Mirú Franco.',
  'heroDestacado', 'Brillo que se nota',
  'productosDescripcion', 'Lo que usamos en el salón, para que lo sigas en casa.',
  'serviciosDescripcion', 'Nuestra carta: elige un servicio para ver qué incluye y reservar tu horario.',
  'trabajoDescripcion', 'Fotos de servicios hechos en el salón. Tócalas para verlas en grande.',
  'sobreNosotrosParrafos', jsonb_build_array(
    'En Mirú Franco, nos dedicamos a realzar tu belleza natural con productos y servicios de la más alta calidad. Nuestro equipo de profesionales está comprometido a brindarte una experiencia excepcional en cada visita.',
    'Estamos en Huejutla de Reyes, Hidalgo. Aquí puedes agendar tus servicios en línea, comprar productos profesionales para el cuidado de tu cabello y recogerlos en el salón.'
  ),
  'sobreNosotrosImagen', '',
  'cierreTitulo', '¿Lista para tu cambio de look?',
  'cierreTexto', 'Agenda una cita con nosotros y descubre la diferencia que hace la calidad profesional.'
)),
('contenido_sobre_nosotros', 'contenido', jsonb_build_object(
  'titulo', 'Pasión por la belleza natural',
  'parrafos', jsonb_build_array(
    'En Mirú Franco, nos dedicamos a realzar tu belleza natural con productos y servicios de la más alta calidad. Nuestro equipo de profesionales está comprometido a brindarte una experiencia excepcional en cada visita.',
    'Estamos en Huejutla de Reyes, Hidalgo. Aquí puedes agendar tus servicios en línea, comprar productos profesionales para el cuidado de tu cabello y recogerlos en el salón.',
    'Cada cliente es único, y por eso diseñamos un plan de cuidado personalizado para adaptarnos a tus necesidades específicas, tu tipo de cabello y tus preferencias de estilo.'
  ),
  'imagen', '',
  'valores', jsonb_build_array(
    jsonb_build_object('titulo', 'Profesionalismo', 'descripcion', 'Cada servicio se ejecuta con técnica depurada y productos de primera calidad.'),
    jsonb_build_object('titulo', 'Calidez', 'descripcion', 'Te recibimos con atención personalizada desde el primer momento.'),
    jsonb_build_object('titulo', 'Innovación', 'descripcion', 'Combinamos técnicas tradicionales con las últimas tendencias del mundo capilar.'),
    jsonb_build_object('titulo', 'Confianza', 'descripcion', 'Construimos relaciones duraderas basadas en resultados reales y honestos.')
  )
)),
('contenido_contacto', 'contenido', jsonb_build_object(
  'introduccion', 'Agenda una cita, resuelve tus dudas o simplemente escríbenos. Estaremos encantados de atenderte.',
  'agendaTexto', 'Elige el servicio, la fecha y la hora que prefieras. Si el servicio pide anticipo, tu cita se confirma al pagarlo.'
)),
('reglas', 'reglas', jsonb_build_object('anticiposDesde', NULL));

-- Semilla: horario por día, desde la fila de configuracion_salon de esta base (la que usa hoy la agenda)
INSERT INTO "configuracion_sitio" ("clave", "tipo", "valor")
SELECT 'horario', 'horario', jsonb_build_object('dias', jsonb_build_array(
  jsonb_build_object('dia', 'lunes', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'martes', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'miercoles', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'jueves', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'viernes', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'sabado', 'cerrado', false, 'abre', COALESCE(c."entrada_sabado", '09:30'), 'cierra', COALESCE(c."salida_sabado", '19:00')),
  jsonb_build_object('dia', 'domingo',
    'cerrado', (c."entrada_domingo" IS NULL OR c."salida_domingo" IS NULL),
    'abre', COALESCE(c."entrada_domingo", ''),
    'cierra', COALESCE(c."salida_domingo", ''))
))
FROM (SELECT 1) AS uno
LEFT JOIN "configuracion_salon" c ON c."id" = 1;

-- Permisos nuevos (admin ya tiene '*'): galería para estilista y empleado; la becaria solo la ve.
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('estilista', ARRAY['galeria:gestionar', 'galeria:lectura'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['galeria:gestionar', 'galeria:lectura']) AS c
);
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('empleado', ARRAY['galeria:gestionar', 'galeria:lectura'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['galeria:gestionar', 'galeria:lectura']) AS c
);
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('becario', ARRAY['galeria:lectura'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['galeria:lectura']) AS c
);

-- -----------------------------------------------------------------------------------------------------
-- 3. 20261016140000_contenido_publico
-- -----------------------------------------------------------------------------------------------------
-- Contenido público administrable: galería (Operaciones > Galería), equipo, promociones y preguntas frecuentes
-- (Admin > Contenido).

-- CreateTable
CREATE TABLE "galeria_fotos" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "public_id" TEXT,
    "alt" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "ilustrativa" BOOLEAN NOT NULL DEFAULT false,
    "sin_personas_identificables" BOOLEAN,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "servicio_id" INTEGER,
    "consentimiento_id" BIGINT,
    "subido_por_id" TEXT,

    CONSTRAINT "galeria_fotos_pkey" PRIMARY KEY ("id"),
    -- Una foto visible necesita la autorización de la clienta o la declaración de que no aparece nadie identificable.
    -- Las fotos anteriores (sin revisar, null) quedan como estaban.
    CONSTRAINT "galeria_fotos_publicable_check" CHECK (
      NOT "visible" OR "sin_personas_identificables" IS NULL OR "sin_personas_identificables" OR "consentimiento_id" IS NOT NULL
    )
);

-- CreateIndex
CREATE INDEX "galeria_fotos_visible_orden_idx" ON "galeria_fotos"("visible", "orden");
CREATE INDEX "galeria_fotos_servicio_id_idx" ON "galeria_fotos"("servicio_id");
CREATE INDEX "galeria_fotos_consentimiento_id_idx" ON "galeria_fotos"("consentimiento_id");

-- AddForeignKey
ALTER TABLE "galeria_fotos" ADD CONSTRAINT "galeria_fotos_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "galeria_fotos" ADD CONSTRAINT "galeria_fotos_consentimiento_id_fkey" FOREIGN KEY ("consentimiento_id") REFERENCES "consentimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "galeria_fotos" ADD CONSTRAINT "galeria_fotos_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Semilla: todas las fotos que ya tienen los servicios. Se ven las mismas que hoy publica la galería (servicio
-- activo, Cloudinary y no generadas con IA); las ilustrativas o de IA quedan ocultas y marcadas. Ninguna está
-- revisada todavía (sin_personas_identificables = null): el panel pide confirmarlo.
INSERT INTO "galeria_fotos" ("url", "public_id", "alt", "orden", "visible", "ilustrativa", "servicio_id", "actualizado_en")
SELECT
  f.url,
  NULL, -- sin public_id: la imagen sigue siendo del servicio y borrar la foto de la galería no la toca en Cloudinary
  'Foto de ' || s."nombre",
  row_number() OVER (ORDER BY s."id", f.pos)::int,
  (s."activo" AND f.url ~* '^https://res\.cloudinary\.com/' AND NOT (f.url ~* 'chatgpt[\s_-]*image|dall[\s_.-]?e|gemini[\s_-]*generated|midjourney|/ilustrativas/')),
  (f.url ~* 'chatgpt[\s_-]*image|dall[\s_.-]?e|gemini[\s_-]*generated|midjourney|/ilustrativas/'),
  s."id",
  CURRENT_TIMESTAMP
FROM "servicios" s
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(s."imagen") = 'array' THEN s."imagen" ELSE '[]'::jsonb END)
  WITH ORDINALITY AS f(url, pos)
WHERE f.url ~* '^https?://';

-- Equipo público: campos en perfiles_empleado (por omisión nadie se muestra)
ALTER TABLE "perfiles_empleado" ADD COLUMN "mostrar_en_sitio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "foto_publica" TEXT,
ADD COLUMN "bio_publica" TEXT,
ADD COLUMN "orden_publico" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "promociones" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "imagen_url" TEXT,
    "enlace" TEXT,
    "vigente_desde" TIMESTAMP(3),
    "vigente_hasta" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "destacada" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promociones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promociones_vigencia_check" CHECK ("vigente_desde" IS NULL OR "vigente_hasta" IS NULL OR "vigente_desde" <= "vigente_hasta")
);
CREATE INDEX "promociones_activa_orden_idx" ON "promociones"("activa", "orden");

-- CreateTable
CREATE TABLE "preguntas_frecuentes" (
    "id" SERIAL NOT NULL,
    "pregunta" TEXT NOT NULL,
    "respuesta" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preguntas_frecuentes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "preguntas_frecuentes_visible_orden_idx" ON "preguntas_frecuentes"("visible", "orden");

-- -----------------------------------------------------------------------------------------------------
-- 4. 20261016150000_politica_cookies_1_1
-- -----------------------------------------------------------------------------------------------------
-- Política de cookies 1.1 (vigente desde el 16 de octubre de 2026): agrega la cookie estrictamente necesaria
-- mf_registro_google del alta con Google. Hash del texto visible publicado (registro documentosLegales.ts de la web).
-- No pide volver a aceptar: el aviso de cookies es informativo y la nueva cookie es estrictamente necesaria.
INSERT INTO "versiones_documentos_legales" ("slug", "version", "hash_texto", "vigente_desde") VALUES
  ('cookies', '1.1', '711f4ceff8d924f7af832522ff43fee726c13b64280ca53efa54b5270cea8607', DATE '2026-10-16')
ON CONFLICT ("slug", "version") DO NOTHING;

-- -----------------------------------------------------------------------------------------------------
-- 5. 20261016160000_firmas_subida
-- -----------------------------------------------------------------------------------------------------
-- Firmas de subida de imágenes (galería y formularios). Solo se registra una imagen subida desde el panel: al firmar,
-- el servidor genera el public_id dentro de la carpeta del uso (galeria/, servicios/, productos/, equipo/,
-- promociones/, sitio/ o usuarios/; con ilustrativas/ si es una imagen ilustrativa), guarda la firma con su vigencia de una hora
-- y la marca como usada al registrar la imagen. Nunca se acepta una URL de imagen escrita a mano.
CREATE TABLE "firmas_subida" (
    "id" SERIAL NOT NULL,
    "uso" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "ilustrativa" BOOLEAN NOT NULL DEFAULT false,
    "usuario_id" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMP(3) NOT NULL,
    "usada_en" TIMESTAMP(3),

    CONSTRAINT "firmas_subida_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "firmas_subida_uso_check" CHECK ("uso" IN ('galeria', 'servicios', 'productos', 'equipo', 'promociones', 'sitio', 'usuarios')),
    CONSTRAINT "firmas_subida_public_id_check" CHECK ("public_id" ~ ('^' || "uso" || '/(ilustrativas/)?panel_[0-9a-f]{32}$'))
);

CREATE UNIQUE INDEX "firmas_subida_public_id_key" ON "firmas_subida"("public_id");
CREATE INDEX "firmas_subida_usuario_id_idx" ON "firmas_subida"("usuario_id");
CREATE INDEX "firmas_subida_usada_en_vence_en_idx" ON "firmas_subida"("usada_en", "vence_en");

ALTER TABLE "firmas_subida" ADD CONSTRAINT "firmas_subida_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Una imagen subida desde el panel queda en una sola foto de la galería (las sembradas tienen public_id NULL).
CREATE UNIQUE INDEX "galeria_fotos_public_id_key" ON "galeria_fotos"("public_id");

COMMIT;

-- Recuerda: después del COMMIT, los cinco npx prisma migrate resolve --applied de arriba.
