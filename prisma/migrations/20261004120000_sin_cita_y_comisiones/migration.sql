-- Cliente sin cita, cobro de citas en el punto de venta, participantes y comisiones fijas por servicio.
-- Solo aditiva: no modifica ni borra datos (cliente_id solo deja de ser obligatorio).
-- La aplica Angel en el SQL Editor de Neon y la marca con:
--   npx prisma migrate resolve --applied 20261004120000_sin_cita_y_comisiones

-- CreateEnum
CREATE TYPE "OrigenCita" AS ENUM ('en_linea', 'mostrador', 'sin_cita');

-- AlterTable
ALTER TABLE "perfiles_empleado" ADD COLUMN     "recibe_comisiones" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "hora_check_out" TIMESTAMP(3),
ADD COLUMN     "nombre_invitado" TEXT,
ADD COLUMN     "origen" "OrigenCita" NOT NULL DEFAULT 'en_linea',
ADD COLUMN     "telefono_invitado" TEXT,
ALTER COLUMN "cliente_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ventas_local" ADD COLUMN     "monto_efectivo" DECIMAL(10,2),
ADD COLUMN     "monto_tarjeta" DECIMAL(10,2),
ADD COLUMN     "monto_transferencia" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ventas_local_items" ADD COLUMN     "cita_id" INTEGER,
ADD COLUMN     "especialista_id" TEXT;

-- CreateTable
CREATE TABLE "venta_item_participantes" (
    "id" SERIAL NOT NULL,
    "comision_monto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venta_item_id" INTEGER NOT NULL,
    "usuario_id" TEXT NOT NULL,

    CONSTRAINT "venta_item_participantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comisiones_servicio" (
    "id" SERIAL NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "servicio_id" INTEGER NOT NULL,
    "actualizado_por_id" TEXT,

    CONSTRAINT "comisiones_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venta_item_participantes_usuario_id_idx" ON "venta_item_participantes"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "venta_item_participantes_venta_item_id_usuario_id_key" ON "venta_item_participantes"("venta_item_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "comisiones_servicio_servicio_id_key" ON "comisiones_servicio"("servicio_id");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_local_items_cita_id_key" ON "ventas_local_items"("cita_id");

-- AddForeignKey
ALTER TABLE "ventas_local_items" ADD CONSTRAINT "ventas_local_items_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas_local_items" ADD CONSTRAINT "ventas_local_items_especialista_id_fkey" FOREIGN KEY ("especialista_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_item_participantes" ADD CONSTRAINT "venta_item_participantes_venta_item_id_fkey" FOREIGN KEY ("venta_item_id") REFERENCES "ventas_local_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_item_participantes" ADD CONSTRAINT "venta_item_participantes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones_servicio" ADD CONSTRAINT "comisiones_servicio_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones_servicio" ADD CONSTRAINT "comisiones_servicio_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Toda cita tiene una clienta registrada o el nombre de la persona atendida sin cuenta.
-- Las citas existentes tienen cliente_id, así que el CHECK se cumple al crearlo.
ALTER TABLE "citas" ADD CONSTRAINT "citas_cliente_o_invitado_check"
  CHECK ("cliente_id" IS NOT NULL OR "nombre_invitado" IS NOT NULL);

-- Permisos nuevos (admin ya tiene '*'). Agrega la clave sin duplicarla y sin pisar las demás.
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('estilista', ARRAY['comisiones:configurar'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = array_append("permisos_rol"."claves", 'comisiones:configurar')
WHERE NOT ('comisiones:configurar' = ANY("permisos_rol"."claves"));

INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('empleado', ARRAY['comisiones:ver_propias']), ('becario', ARRAY['comisiones:ver_propias'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = array_append("permisos_rol"."claves", 'comisiones:ver_propias')
WHERE NOT ('comisiones:ver_propias' = ANY("permisos_rol"."claves"));
