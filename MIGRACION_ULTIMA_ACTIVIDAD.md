# 🔄 Migración: Agregar Campo ultima_actividad

## 📋 Resumen

Se agregó el campo `ultima_actividad` a la tabla `usuarios` para rastrear correctamente la inactividad de sesiones.

## 🔧 Problema Resuelto

**Problema anterior:**
- El `lastActivity` estaba solo en el token JWT (inmutable)
- No se actualizaba en cada petición
- La verificación de inactividad no funcionaba correctamente

**Solución implementada:**
- Campo `ultima_actividad` en la base de datos
- Se actualiza en cada petición autenticada
- Verificación contra la base de datos (más confiable)

## 📝 Cambios en la Base de Datos

### Script SQL a Ejecutar

**Archivo:** `prisma/migrations/add_ultima_actividad.sql`

```sql
-- Agregar campo ultima_actividad para rastrear inactividad de sesiones
ALTER TABLE "usuarios" 
ADD COLUMN IF NOT EXISTS "ultima_actividad" TIMESTAMP;

-- Crear índice para mejorar rendimiento de consultas de inactividad
CREATE INDEX IF NOT EXISTS "idx_usuarios_ultima_actividad" ON "usuarios"("ultima_actividad");
```

## 🚀 Cómo Aplicar la Migración

### Opción 1: Desde Neon SQL Editor (Recomendado)

1. Ve a tu dashboard de Neon
2. Abre el **SQL Editor**
3. Copia y pega el contenido de `prisma/migrations/add_ultima_actividad.sql`
4. Ejecuta el script

### Opción 2: Desde línea de comandos (si tienes acceso directo)

```bash
psql $DATABASE_URL -f prisma/migrations/add_ultima_actividad.sql
```

## ✅ Verificación

Después de ejecutar la migración, verifica que el campo existe:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'usuarios' 
AND column_name = 'ultima_actividad';
```

**Resultado esperado:**
```
column_name      | data_type
-----------------|----------
ultima_actividad | timestamp without time zone
```

## 🔄 Cómo Funciona Ahora

1. **Al hacer login:**
   - Se guarda `ultima_actividad = NOW()` en la base de datos

2. **En cada petición autenticada:**
   - Se verifica si `ultima_actividad` es mayor a 15 minutos
   - Si es mayor → Error 401 "Sesión expirada por inactividad"
   - Si es menor → Se actualiza `ultima_actividad = NOW()` y continúa

3. **Después de 15 minutos de inactividad:**
   - La próxima petición será rechazada
   - El usuario debe iniciar sesión nuevamente

## 📊 Cambios en el Código

### Archivos Modificados:

1. **`prisma/schema.prisma`**
   - Agregado campo `ultimaActividad`

2. **`src/common/services/security.service.ts`**
   - Agregado `updateLastActivity(userId)`
   - Agregado `isUserInactive(userId, timeout)`

3. **`src/auth/strategies/jwt.strategy.ts`**
   - Verifica inactividad contra la base de datos
   - Actualiza `ultima_actividad` en cada petición

4. **`src/usuarios/usuarios.service.ts`**
   - Actualiza `ultima_actividad` al hacer login

## ⚠️ Importante

- **Debes ejecutar la migración SQL** antes de desplegar
- El campo es opcional (`DateTime?`) así que no rompe usuarios existentes
- Los usuarios existentes tendrán `ultima_actividad = NULL` hasta su próxima petición

## 🧪 Prueba

1. **Hacer login:**
   ```bash
   POST /api/usuarios/login
   ```

2. **Verificar en BD:**
   ```sql
   SELECT email, ultima_actividad 
   FROM usuarios 
   WHERE email = 'tu@email.com';
   ```
   - Debe tener una fecha reciente

3. **Esperar 16 minutos sin hacer peticiones**

4. **Hacer una petición autenticada:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token>
   ```
   - **Resultado esperado:** Error 401 "Sesión expirada por inactividad"

