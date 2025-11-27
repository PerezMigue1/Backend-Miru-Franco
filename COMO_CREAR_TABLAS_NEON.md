# 📋 Cómo Crear las Tablas en Neon PostgreSQL

## ⚠️ Problema

Si ves error 500 en Google OAuth o cualquier endpoint, probablemente las tablas no existen en PostgreSQL.

## ✅ Solución: Crear Tablas Manualmente

### Opción 1: Usar SQL Editor de Neon (Más Fácil)

1. Ve a tu dashboard de Neon: https://console.neon.tech
2. Selecciona tu proyecto
3. Ve a "SQL Editor"
4. Copia y pega el contenido de `prisma/migrations/init_postgresql.sql`
5. Ejecuta el script (botón "Run")

### Opción 2: Usar Prisma Migrate (Recomendado)

**Desde tu máquina local:**

1. Asegúrate de tener `DATABASE_URL` en tu `.env`:
```env
DATABASE_URL=postgresql://neondb_owner:npg_3XrzHPCy4KLM@ep-hidden-cell-adcoofcw-pooler.c-2.us-east-1.aws.neon.tech/miru?sslmode=require
```

2. Ejecuta las migraciones:
```bash
# Crear migración
npx prisma migrate dev --name init_postgresql

# O aplicar directamente (si ya existe)
npx prisma migrate deploy
```

### Opción 3: Usar Prisma Push (Rápido, solo para desarrollo)

```bash
npx prisma db push
```

⚠️ **Nota:** `db push` no crea migraciones, solo sincroniza el schema. Usa `migrate dev` para producción.

## 🔍 Verificar que las Tablas Existen

Después de crear las tablas, puedes verificar:

1. **En Neon SQL Editor**, ejecuta:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

Deberías ver:
- `usuarios`
- `preguntas_seguridad`
- `direcciones`
- `perfiles_capilares`

2. **O usa Prisma Studio:**
```bash
npx prisma studio
```

## 🚨 Si las Tablas No Existen

Si intentas usar la API sin las tablas, verás errores como:
- `Error 500` en cualquier endpoint
- `relation "usuarios" does not exist`
- `table "usuarios" does not exist`

**Solución:** Ejecuta el script SQL o las migraciones antes de usar la API.

