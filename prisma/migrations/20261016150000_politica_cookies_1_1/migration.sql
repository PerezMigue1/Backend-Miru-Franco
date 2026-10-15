-- Política de cookies 1.1 (vigente desde el 16 de octubre de 2026): agrega la cookie estrictamente necesaria
-- mf_registro_google del alta con Google. Hash del texto visible publicado (registro documentosLegales.ts de la web).
-- No pide volver a aceptar: el aviso de cookies es informativo y la nueva cookie es estrictamente necesaria.
INSERT INTO "versiones_documentos_legales" ("slug", "version", "hash_texto", "vigente_desde") VALUES
  ('cookies', '1.1', '711f4ceff8d924f7af832522ff43fee726c13b64280ca53efa54b5270cea8607', DATE '2026-10-16')
ON CONFLICT ("slug", "version") DO NOTHING;
