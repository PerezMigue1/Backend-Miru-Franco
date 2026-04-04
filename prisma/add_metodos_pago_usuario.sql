-- Tabla metodos_pago_usuario (alineada con Prisma: columna ultimos_4).
-- Ejecutar en Neon si no usas prisma migrate deploy.

DO $$ BEGIN
  CREATE TYPE "TipoTarjetaGuardada" AS ENUM ('credito', 'debito');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS metodos_pago_usuario (
  id                 TEXT NOT NULL PRIMARY KEY,
  proveedor          TEXT NOT NULL,
  id_externo         TEXT NOT NULL,
  marca              TEXT,
  ultimos_4          VARCHAR(4) NOT NULL,
  banco_nombre       TEXT,
  exp_mes            INTEGER,
  exp_anio           INTEGER,
  tipo_tarjeta       "TipoTarjetaGuardada",
  es_virtual         BOOLEAN NOT NULL DEFAULT FALSE,
  etiqueta           TEXT,
  es_predeterminada  BOOLEAN NOT NULL DEFAULT FALSE,
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id         TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT metodos_pago_usuario_usuario_proveedor_id_externo_key UNIQUE (usuario_id, proveedor, id_externo)
);

CREATE INDEX IF NOT EXISTS metodos_pago_usuario_usuario_id_idx ON metodos_pago_usuario(usuario_id);
CREATE INDEX IF NOT EXISTS metodos_pago_usuario_usuario_id_activo_idx ON metodos_pago_usuario(usuario_id, activo);
