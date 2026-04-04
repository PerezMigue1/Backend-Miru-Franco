-- Ejecutar en Neon si el error dice que falta producto_presentaciones.imagenes
ALTER TABLE "producto_presentaciones"
ADD COLUMN IF NOT EXISTS "imagenes" TEXT[] DEFAULT ARRAY[]::TEXT[];
