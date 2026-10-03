-- Solo aditiva: un valor de enum, dos columnas opcionales, índices y llaves foráneas. No borra ni cambia datos.
-- La aplica Angel en el SQL Editor de Neon y la marca con: npx prisma migrate resolve --applied 20261003180000_pagos_en_linea_y_cobro
-- AlterEnum
ALTER TYPE "EstadoPago" ADD VALUE 'en_revision';

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "cobrado_por_id" TEXT,
ADD COLUMN     "corte_id" INTEGER;

-- CreateIndex
CREATE INDEX "pagos_cobrado_por_id_pagado_en_idx" ON "pagos"("cobrado_por_id", "pagado_en");

-- CreateIndex
CREATE INDEX "pagos_corte_id_idx" ON "pagos"("corte_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_proveedor_referencia_externa_key" ON "pagos"("proveedor", "referencia_externa");

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cobrado_por_id_fkey" FOREIGN KEY ("cobrado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_corte_id_fkey" FOREIGN KEY ("corte_id") REFERENCES "cortes_caja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

