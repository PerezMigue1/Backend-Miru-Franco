-- Sesiones de la app móvil (30 días sin uso, token de renovación rotativo) y tratamientos del perfil
-- capilar. Va DESPUÉS de 20261005120000_anticipos_de_citas.
-- Solo aditiva: crea la tabla sesiones_moviles y agrega dos columnas a usuarios (tratamientos_quimicos
-- con default false, tratamientos nulo); no modifica ni borra datos.
-- La aplica Angel en el SQL Editor de Neon y la marca con:
--   npx prisma migrate resolve --applied 20261007120000_sesiones_moviles_y_tratamientos

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "tratamientos" TEXT,
ADD COLUMN     "tratamientos_quimicos" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sesiones_moviles" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "familia_id" TEXT NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "revocada_en" TIMESTAMP(3),
    "reemplazada_por_id" TEXT,
    "dispositivo" VARCHAR(80),

    CONSTRAINT "sesiones_moviles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_moviles_token_hash_key" ON "sesiones_moviles"("token_hash");

-- CreateIndex
CREATE INDEX "sesiones_moviles_usuario_id_idx" ON "sesiones_moviles"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_moviles_familia_id_idx" ON "sesiones_moviles"("familia_id");

-- AddForeignKey
ALTER TABLE "sesiones_moviles" ADD CONSTRAINT "sesiones_moviles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

