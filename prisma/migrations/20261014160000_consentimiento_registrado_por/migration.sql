-- Consentimientos capturados por el personal: registrado_por_id guarda quién registró la fila cuando no fue la
-- titular (el admin al dar de alta una cuenta o al capturar datos de salud en la ficha, o el personal al
-- revocar promociones). Queda NULL cuando la registró la propia titular o un visitante.
-- Va DESPUÉS de 20261014150000_revocacion_compra.
-- consentimientos es de SOLO INSERCIÓN (su trigger rechaza UPDATE): la llave foránea no lleva ninguna acción que
-- modifique filas (ON DELETE RESTRICT y ON UPDATE RESTRICT). Mismo tipo que usuarios.id (TEXT con el uuid).
-- Solo aditiva: agrega una columna que admite NULL, su índice y su llave foránea; no modifica ni borra datos.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014160000_consentimiento_registrado_por

-- AlterTable
ALTER TABLE "consentimientos" ADD COLUMN "registrado_por_id" TEXT;

-- CreateIndex
CREATE INDEX "consentimientos_registrado_por_id_idx" ON "consentimientos"("registrado_por_id");

-- AddForeignKey
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
