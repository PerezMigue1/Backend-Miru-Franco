-- Anticipo en el salón: la clienta elige pagar el anticipo en el salón y el plazo pasa a ser 15 min
-- antes del inicio de la cita. Va DESPUÉS de 20261010120000_devoluciones_y_salidas_de_caja.
-- Solo aditiva: no modifica ni borra datos; las citas existentes quedan en false.
-- La aplica Angel en el SQL Editor de Neon y la marca con:
--   npx prisma migrate resolve --applied 20261011120000_anticipo_en_salon

-- AlterTable
ALTER TABLE "citas" ADD COLUMN "anticipo_en_salon" BOOLEAN NOT NULL DEFAULT false;
