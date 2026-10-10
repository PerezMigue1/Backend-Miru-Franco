-- Devoluciones con resolución por el personal (clave devoluciones:gestionar), salidas de efectivo de caja
-- (reembolsos en efectivo que se descuentan en el corte abierto) y fecha de reembolso de los pagos.
-- Va DESPUÉS de 20261007120000_sesiones_moviles_y_tratamientos.
-- Solo aditiva: crea la tabla movimientos_caja y dos enums, agrega columnas nulas o con default a
-- devoluciones, pagos y cortes_caja, y agrega la clave devoluciones:gestionar a la estilista. No modifica
-- ni borra datos existentes.
-- La aplica Angel en el SQL Editor de Neon y la marca con:
--   npx prisma migrate resolve --applied 20261010120000_devoluciones_y_salidas_de_caja

-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('salida');

-- CreateEnum
CREATE TYPE "ConceptoMovimientoCaja" AS ENUM ('reembolso_anticipo', 'reembolso_pedido', 'reembolso_devolucion');

-- AlterTable
ALTER TABLE "cortes_caja" ADD COLUMN     "total_salidas" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "devoluciones" ADD COLUMN     "causa" TEXT,
ADD COLUMN     "metodo_reembolso" TEXT,
ADD COLUMN     "nota_resolucion" TEXT,
ADD COLUMN     "resuelto_en" TIMESTAMP(3),
ADD COLUMN     "resuelto_por_id" TEXT,
ADD COLUMN     "tipo" TEXT;

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "reembolsado_en" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "movimientos_caja" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL DEFAULT 'salida',
    "concepto" "ConceptoMovimientoCaja" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registrado_por_id" TEXT NOT NULL,
    "corte_id" INTEGER,
    "pago_id" INTEGER,
    "devolucion_id" INTEGER,

    CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id"),
    -- Una salida viene de un pago o de una devolución, nunca de los dos (ambos nulos solo si el origen se borró).
    CONSTRAINT "movimientos_caja_un_origen" CHECK (num_nonnulls("pago_id", "devolucion_id") <= 1),
    CONSTRAINT "movimientos_caja_monto_positivo" CHECK ("monto" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_caja_pago_id_key" ON "movimientos_caja"("pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_caja_devolucion_id_key" ON "movimientos_caja"("devolucion_id");

-- CreateIndex
CREATE INDEX "movimientos_caja_registrado_por_id_creado_en_idx" ON "movimientos_caja"("registrado_por_id", "creado_en");

-- CreateIndex
CREATE INDEX "movimientos_caja_corte_id_idx" ON "movimientos_caja"("corte_id");

-- AddForeignKey
ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_resuelto_por_id_fkey" FOREIGN KEY ("resuelto_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_corte_id_fkey" FOREIGN KEY ("corte_id") REFERENCES "cortes_caja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "devoluciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permiso nuevo (admin ya tiene '*'). Agrega la clave sin duplicarla y sin pisar las demás.
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('estilista', ARRAY['devoluciones:gestionar'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = array_append("permisos_rol"."claves", 'devoluciones:gestionar')
WHERE NOT ('devoluciones:gestionar' = ANY("permisos_rol"."claves"));
