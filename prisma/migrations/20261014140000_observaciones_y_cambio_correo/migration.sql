-- Observaciones del personal sobre una clienta (observaciones_cliente) y cambio de correo verificado con un
-- código (solicitudes_cambio_correo: solo se guarda el hash del código, nunca el código).
-- Va DESPUÉS de 20261014130000_privacidad_y_consentimientos.
-- Solo aditiva: crea dos tablas; no modifica ni borra datos existentes.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014140000_observaciones_y_cambio_correo

-- CreateTable
CREATE TABLE "observaciones_cliente" (
    "id" SERIAL NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "autor_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "observaciones_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_cambio_correo" (
    "id" SERIAL NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "correo_nuevo" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "usado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "solicitudes_cambio_correo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observaciones_cliente_cliente_id_idx" ON "observaciones_cliente"("cliente_id");

-- CreateIndex
CREATE INDEX "solicitudes_cambio_correo_usuario_id_idx" ON "solicitudes_cambio_correo"("usuario_id");

-- AddForeignKey
ALTER TABLE "observaciones_cliente" ADD CONSTRAINT "observaciones_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observaciones_cliente" ADD CONSTRAINT "observaciones_cliente_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_cambio_correo" ADD CONSTRAINT "solicitudes_cambio_correo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
