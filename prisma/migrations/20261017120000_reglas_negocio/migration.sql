-- Reglas de negocio completas (Admin > Configuración del sitio > Reglas) y la regla con que se creó cada cita y
-- cada pedido. Semilla: los valores que hoy usa el código, para que nada cambie al desplegar. Lo que ya estaba
-- guardado en la fila "reglas" (la fecha de inicio de anticipos) se conserva tal cual.
-- Las citas y pedidos ya creados quedan con "reglas" en NULL: el backend los trata con los valores de hoy.

-- AlterTable
ALTER TABLE "citas" ADD COLUMN "reglas" JSONB;

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN "reglas" JSONB;

-- Semilla: valores de hoy debajo de lo que ya estaba guardado (lo guardado gana).
INSERT INTO "configuracion_sitio" ("clave", "tipo", "valor")
VALUES ('reglas', 'reglas', '{}'::jsonb)
ON CONFLICT ("clave") DO NOTHING;

UPDATE "configuracion_sitio"
SET "valor" = '{"anticiposDesde":null,"citas":{"plazoAnticipoHoras":2,"minutosAntesPagoSalon":15,"minutosLlegadaAntes":20,"toleranciaLlegadaMinutos":15,"porcentajeAnticipoSugerido":0,"horasAvisoCancelarReagendar":0,"noAsistio":{"pierdeAnticipo":true,"mesesSoloPagoEnLinea":6},"maxCitasPorPagarEnSalon":1,"permitirAnticipoEnSalon":true,"intervaloHorariosMinutos":30,"recordatoriosHorasAntes":[24,1],"diasHabilesExcepcionAnticipo":10,"diasHabilesCancelarConReembolso":5},"tienda":{"apartadosDesde":null,"plazoPagoLineaHoras":24,"diasPrepararApartado":3,"diaRecordatorioRecoger":3,"diasCancelarNoRecogido":7,"diasResguardoPagado":15,"tiempoPreparacionTexto":"Suele estar listo en 24 a 48 horas hábiles","diasCambioProducto":7},"revocacion":{"diasHabiles":5},"garantia":{"diasServicio":7},"facturacion":{"plazoTexto":"dentro del mismo mes de tu compra o servicio"},"arco":{"diasHabilesRespuesta":20,"diasHabilesEfectividad":15,"diasAvisoVencePronto":5},"pagos":{"mercadoPagoTienda":true,"mercadoPagoAnticipos":true,"salon":{"efectivo":true,"tarjeta":true,"transferencia":true},"transferencia":{"banco":"","titular":"","clabe":""}},"diasInhabiles":[]}'::jsonb || "valor"
WHERE "clave" = 'reglas';
