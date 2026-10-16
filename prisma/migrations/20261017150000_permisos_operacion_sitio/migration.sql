-- Operaciones > Horario y días inhábiles (horario:editar) y Operaciones > Equipo en el sitio (equipo:publico).
-- Semilla: solo la estilista (el admin ya tiene '*'). El admin puede dárselos a otros roles en Permisos por rol.
-- Agrega las claves sin quitar ninguna de las que ya tiene el rol.
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('estilista', ARRAY['horario:editar', 'equipo:publico'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['horario:editar', 'equipo:publico']) AS c
);
