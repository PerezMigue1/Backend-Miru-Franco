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
