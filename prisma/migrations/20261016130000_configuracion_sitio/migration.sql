-- Configuración del sitio (Admin > Configuración del sitio) y su historial de cambios.
-- Semilla: los valores que hoy publica el sitio, para que nada cambie al desplegar. El horario sale de la fila de
-- configuracion_salon de cada base (la que usa la agenda); "anticiposDesde" queda en null y el backend sigue usando
-- la variable ANTICIPOS_DESDE como respaldo hasta que se guarde una fecha aquí.

-- CreateTable
CREATE TABLE "configuracion_sitio" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "tipo" TEXT NOT NULL,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_por_id" TEXT,

    CONSTRAINT "configuracion_sitio_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "historial_configuracion_sitio" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "valor_anterior" JSONB,
    "valor_nuevo" JSONB NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_por_id" TEXT,

    CONSTRAINT "historial_configuracion_sitio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historial_configuracion_sitio_clave_creado_en_idx" ON "historial_configuracion_sitio"("clave", "creado_en");

-- AddForeignKey
ALTER TABLE "configuracion_sitio" ADD CONSTRAINT "configuracion_sitio_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "historial_configuracion_sitio" ADD CONSTRAINT "historial_configuracion_sitio_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Historial de solo inserción (misma función que consentimientos)
CREATE TRIGGER "historial_configuracion_sitio_solo_insercion"
  BEFORE UPDATE OR DELETE ON "historial_configuracion_sitio"
  FOR EACH ROW EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

CREATE TRIGGER "historial_configuracion_sitio_sin_truncate"
  BEFORE TRUNCATE ON "historial_configuracion_sitio"
  FOR EACH STATEMENT EXECUTE FUNCTION "rechazar_cambios_solo_insercion"();

-- Semilla: datos del salón (los mismos de los Términos, el Aviso y el checkout)
INSERT INTO "configuracion_sitio" ("clave", "tipo", "valor") VALUES
('salon', 'salon', jsonb_build_object(
  'nombre', 'Mirú Franco Salón Beauty',
  'responsable', 'Mildred Rubí Franco Martínez',
  'direccion', 'Segunda Cerrada de Allende No. 15, Col. Juárez',
  'ciudad', 'Huejutla de Reyes, Hidalgo',
  'codigoPostal', '43000',
  'telefono', '+52 771 268 1432',
  'whatsapp', '+52 771 186 7645',
  'correoContacto', 'contacto@mirufranco.com',
  'correoPrivacidad', 'mildredfranco24@gmail.com',
  'mapaUrl', '',
  'lema', 'Salón de belleza profesional dedicado a realzar tu belleza natural con productos y servicios de alta calidad.',
  'descripcionSeo', 'Salón de belleza profesional en Huejutla de Reyes. Cortes, coloración, tratamientos capilares, alaciado y nanoplastía. Agenda tu cita en línea.'
)),
('redes', 'redes', jsonb_build_object('instagram', '', 'facebook', '', 'tiktok', '', 'twitter', '')),
('contenido_inicio', 'contenido', jsonb_build_object(
  'heroTexto', 'Realza tu belleza natural con productos y servicios profesionales. Agenda tu cita y descubre la experiencia Mirú Franco.',
  'heroDestacado', 'Brillo que se nota',
  'productosDescripcion', 'Lo que usamos en el salón, para que lo sigas en casa.',
  'serviciosDescripcion', 'Nuestra carta: elige un servicio para ver qué incluye y reservar tu horario.',
  'trabajoDescripcion', 'Fotos de servicios hechos en el salón. Tócalas para verlas en grande.',
  'sobreNosotrosParrafos', jsonb_build_array(
    'En Mirú Franco, nos dedicamos a realzar tu belleza natural con productos y servicios de la más alta calidad. Nuestro equipo de profesionales está comprometido a brindarte una experiencia excepcional en cada visita.',
    'Estamos en Huejutla de Reyes, Hidalgo. Aquí puedes agendar tus servicios en línea, comprar productos profesionales para el cuidado de tu cabello y recogerlos en el salón.'
  ),
  'sobreNosotrosImagen', '',
  'cierreTitulo', '¿Lista para tu cambio de look?',
  'cierreTexto', 'Agenda una cita con nosotros y descubre la diferencia que hace la calidad profesional.'
)),
('contenido_sobre_nosotros', 'contenido', jsonb_build_object(
  'titulo', 'Pasión por la belleza natural',
  'parrafos', jsonb_build_array(
    'En Mirú Franco, nos dedicamos a realzar tu belleza natural con productos y servicios de la más alta calidad. Nuestro equipo de profesionales está comprometido a brindarte una experiencia excepcional en cada visita.',
    'Estamos en Huejutla de Reyes, Hidalgo. Aquí puedes agendar tus servicios en línea, comprar productos profesionales para el cuidado de tu cabello y recogerlos en el salón.',
    'Cada cliente es único, y por eso diseñamos un plan de cuidado personalizado para adaptarnos a tus necesidades específicas, tu tipo de cabello y tus preferencias de estilo.'
  ),
  'imagen', '',
  'valores', jsonb_build_array(
    jsonb_build_object('titulo', 'Profesionalismo', 'descripcion', 'Cada servicio se ejecuta con técnica depurada y productos de primera calidad.'),
    jsonb_build_object('titulo', 'Calidez', 'descripcion', 'Te recibimos con atención personalizada desde el primer momento.'),
    jsonb_build_object('titulo', 'Innovación', 'descripcion', 'Combinamos técnicas tradicionales con las últimas tendencias del mundo capilar.'),
    jsonb_build_object('titulo', 'Confianza', 'descripcion', 'Construimos relaciones duraderas basadas en resultados reales y honestos.')
  )
)),
('contenido_contacto', 'contenido', jsonb_build_object(
  'introduccion', 'Agenda una cita, resuelve tus dudas o simplemente escríbenos. Estaremos encantados de atenderte.',
  'agendaTexto', 'Elige el servicio, la fecha y la hora que prefieras. Si el servicio pide anticipo, tu cita se confirma al pagarlo.'
)),
('reglas', 'reglas', jsonb_build_object('anticiposDesde', NULL));

-- Semilla: horario por día, desde la fila de configuracion_salon de esta base (la que usa hoy la agenda)
INSERT INTO "configuracion_sitio" ("clave", "tipo", "valor")
SELECT 'horario', 'horario', jsonb_build_object('dias', jsonb_build_array(
  jsonb_build_object('dia', 'lunes', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'martes', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'miercoles', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'jueves', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'viernes', 'cerrado', false, 'abre', COALESCE(c."entrada_lunes_viernes", '09:30'), 'cierra', COALESCE(c."salida_lunes_viernes", '19:30')),
  jsonb_build_object('dia', 'sabado', 'cerrado', false, 'abre', COALESCE(c."entrada_sabado", '09:30'), 'cierra', COALESCE(c."salida_sabado", '19:00')),
  jsonb_build_object('dia', 'domingo',
    'cerrado', (c."entrada_domingo" IS NULL OR c."salida_domingo" IS NULL),
    'abre', COALESCE(c."entrada_domingo", ''),
    'cierra', COALESCE(c."salida_domingo", ''))
))
FROM (SELECT 1) AS uno
LEFT JOIN "configuracion_salon" c ON c."id" = 1;

-- Permisos nuevos (admin ya tiene '*'): galería para estilista y empleado; la becaria solo la ve.
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('estilista', ARRAY['galeria:gestionar', 'galeria:lectura'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['galeria:gestionar', 'galeria:lectura']) AS c
);
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('empleado', ARRAY['galeria:gestionar', 'galeria:lectura'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['galeria:gestionar', 'galeria:lectura']) AS c
);
INSERT INTO "permisos_rol" ("rol", "claves") VALUES ('becario', ARRAY['galeria:lectura'])
ON CONFLICT ("rol") DO UPDATE SET "claves" = (
  SELECT array_agg(DISTINCT c) FROM unnest("permisos_rol"."claves" || ARRAY['galeria:lectura']) AS c
);
