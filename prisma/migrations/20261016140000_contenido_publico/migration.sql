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
