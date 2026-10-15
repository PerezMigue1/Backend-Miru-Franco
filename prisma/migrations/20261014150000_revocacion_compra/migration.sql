-- Revocación de compra (art. 56 de la Ley Federal de Protección al Consumidor): marca en devoluciones las que
-- vienen de una revocación dentro de los 5 días hábiles (origen = 'revocacion_art56'); las demás son
-- solicitudes de cambio o reembolso por la política de devoluciones (origen = 'solicitud').
-- La fecha de entrega NO lleva columna: sale del historial (historial_estados_pedido con estado_nuevo =
-- 'entregado', que registran todas las entregas) y, si no se ha entregado, el plazo corre desde pedidos.pagado_en.
-- Va DESPUÉS de 20261014140000_observaciones_y_cambio_correo.
-- Solo aditiva: agrega una columna con default; las devoluciones existentes quedan en 'solicitud'.
-- La aplica Angel en el SQL Editor de Neon (producción) y la marca con:
--   npx prisma migrate resolve --applied 20261014150000_revocacion_compra

-- AlterTable
ALTER TABLE "devoluciones" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'solicitud';

ALTER TABLE "devoluciones" ADD CONSTRAINT "devoluciones_origen_check" CHECK ("origen" IN ('solicitud', 'revocacion_art56'));
