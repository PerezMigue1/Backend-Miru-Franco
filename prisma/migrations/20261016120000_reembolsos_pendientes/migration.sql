-- Admin > Reembolsos pendientes: cada reintento y cada reembolso manual de un pago en revisión queda aquí.
-- CreateTable
CREATE TABLE "historial_reembolsos" (
    "id" SERIAL NOT NULL,
    "accion" TEXT NOT NULL,
    "referencia" TEXT,
    "nota" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pago_id" INTEGER NOT NULL,
    "usuario_id" TEXT,

    CONSTRAINT "historial_reembolsos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "historial_reembolsos_accion_check" CHECK ("accion" IN ('reintento', 'reintento_fallido', 'manual'))
);

-- CreateIndex
CREATE INDEX "historial_reembolsos_pago_id_idx" ON "historial_reembolsos"("pago_id");

-- AddForeignKey
ALTER TABLE "historial_reembolsos" ADD CONSTRAINT "historial_reembolsos_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historial_reembolsos" ADD CONSTRAINT "historial_reembolsos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Solo inserción (misma función que consentimientos)
CREATE TRIGGER "historial_reembolsos_solo_insercion"
  BEFORE UPDATE OR DELETE ON "historial_reembolsos"
  FOR EACH ROW EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

CREATE TRIGGER "historial_reembolsos_sin_truncate"
  BEFORE TRUNCATE ON "historial_reembolsos"
  FOR EACH STATEMENT EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();
