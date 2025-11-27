# 📦 Guía: Migración de Datos MongoDB a PostgreSQL

## ⚠️ Respuesta a tu Pregunta

**NO**, los datos **NO se pasan solos**. Necesitas ejecutar un script de migración para transferir los datos de MongoDB a PostgreSQL.

## 🔍 ¿Por qué no se migran automáticamente?

- **MongoDB** y **PostgreSQL** son bases de datos diferentes
- La estructura cambió:
  - **Antes (MongoDB)**: Campos embebidos dentro del documento usuario
  - **Ahora (PostgreSQL)**: Tablas separadas con relaciones

## 🚀 Cómo Migrar los Datos

### Opción 1: Usar el Script de Migración (Recomendado)

1. **Instalar dependencias adicionales:**
```bash
npm install mongodb
npm install --save-dev @types/mongodb
```

2. **Configurar variables de entorno:**
```env
# En tu archivo .env o directamente en el script
MONGODB_URI=mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority
MONGODB_DB=estetica-miru-franco
DATABASE_URL=postgresql://neondb_owner:npg_3XrzHPCy4KLM@ep-hidden-cell-adcoofcw-pooler.c-2.us-east-1.aws.neon.tech/miru?sslmode=require
```

3. **Ejecutar el script de migración:**
```bash
npx ts-node scripts/migrate-mongodb-to-postgresql.ts
```

### Opción 2: Migración Manual

Si prefieres migrar manualmente, puedes usar Prisma Studio o herramientas como pgAdmin.

## 📋 Lo que hace el Script

1. ✅ Conecta a MongoDB
2. ✅ Conecta a PostgreSQL
3. ✅ Lee todos los usuarios de MongoDB
4. ✅ Crea usuarios en PostgreSQL con:
   - Datos básicos del usuario
   - Pregunta de seguridad (en tabla separada)
   - Dirección (en tabla separada)
   - Perfil capilar (en tabla separada)
5. ✅ Maneja errores (ej: usuarios duplicados)

## 🔍 Estructura de Datos

### MongoDB → PostgreSQL

**Usuario:**
- `_id` (ObjectId) → `id` (UUID) - Se genera nuevo UUID
- Campos básicos se migran directamente
- `preguntaSeguridad` (objeto) → Tabla `preguntas_seguridad` (relación 1:1)
- `direccion` (objeto) → Tabla `direcciones` (relación 1:1)
- `perfilCapilar` (objeto) → Tabla `perfiles_capilares` (relación 1:1)

**Preguntas de Seguridad:**
- La colección `pregunta-seguridad` en MongoDB no se migra directamente
- Las preguntas ya están embebidas en los usuarios
- Se crearán automáticamente cuando se migren los usuarios

## ⚠️ Advertencias Importantes

1. **IDs Cambian**: Los `_id` de MongoDB se convertirán en nuevos UUIDs en PostgreSQL
2. **Referencias Externas**: Si tienes otras colecciones que referencian `_id` de usuarios, necesitarás actualizarlas
3. **Backup**: Siempre haz backup antes de migrar
4. **Pruebas**: Prueba la migración en un ambiente de desarrollo primero

## ✅ Después de la Migración

1. Verifica que todos los usuarios se migraron correctamente
2. Prueba el login con algunos usuarios
3. Verifica que las preguntas de seguridad funcionan
4. Verifica que los perfiles se muestran correctamente

## 🆘 Si algo sale mal

El script maneja errores y continúa con los siguientes usuarios. Revisa los logs para ver qué usuarios no se migraron y por qué.

