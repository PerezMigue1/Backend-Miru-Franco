-- Anticipos de citas: el servicio define el anticipo, la cita guarda la foto del monto y su plazo,
-- y el pago (en línea o en el salón) se liga a la cita. Va DESPUÉS de 20261004120000_sin_cita_y_comisiones.
-- Solo aditiva: no modifica ni borra datos (pedido_id solo deja de ser obligatorio; los 3006 pagos
-- actuales tienen pedido_id, así que el CHECK se cumple al crearlo).
-- La aplica Angel en el SQL Editor de Neon y la marca con:
--   npx prisma migrate resolve --applied 20261005120000_anticipos_de_citas

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "cita_id" INTEGER,
ADD COLUMN     "retenido_en" TIMESTAMP(3),
ALTER COLUMN "pedido_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "servicios" ADD COLUMN     "anticipo_monto" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "anticipo_pagado_en" TIMESTAMP(3),
ADD COLUMN     "anticipo_requerido" DECIMAL(10,2),
ADD COLUMN     "anticipo_vence_en" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ventas_local" ADD COLUMN     "anticipo" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "pagos_cita_id_idx" ON "pagos"("cita_id");

-- CreateIndex
CREATE INDEX "citas_anticipo_vence_en_idx" ON "citas"("anticipo_vence_en");

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Todo pago es de exactamente uno: un pedido o el anticipo de una cita.
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_pedido_o_cita_check"
  CHECK (num_nonnulls("pedido_id", "cita_id") = 1);
