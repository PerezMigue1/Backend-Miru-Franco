# 🗄️ Guía de Migración: MongoDB a PostgreSQL (Neon)

## 📋 Cambios Realizados

### 1. Schema de Prisma (`prisma/schema.prisma`)

**Antes (MongoDB):**
- Campos embebidos como `Json?` (preguntaSeguridad, direccion, perfilCapilar)
- IDs tipo `@db.ObjectId`
- Sin relaciones explícitas

**Después (PostgreSQL):**
- Modelos separados con relaciones:
  - `PreguntaSeguridad` → relación 1:1 con `Usuario`
  - `Direccion` → relación 1:1 con `Usuario`
  - `PerfilCapilar` → relación 1:1 con `Usuario`
- IDs tipo UUID (`@default(uuid())`)
- Relaciones explícitas con `onDelete: Cascade`

### 2. Servicios Actualizados

- ✅ `usuarios.service.ts`: Actualizado para usar relaciones en `crearUsuario()`, `obtenerPreguntaSeguridad()`, `validarRespuestaSeguridad()`, `obtenerPerfilUsuario()`
- ✅ `pregunta-seguridad.service.ts`: Actualizado para usar el modelo `PreguntaSeguridad` directamente
- ✅ `auth/strategies/google.strategy.ts`: Actualizado para crear usuarios sin relaciones requeridas

### 3. Variables de Entorno

**Cambiar en Render:**
- ❌ `MONGODB_URI` → ✅ `DATABASE_URL`

**Formato de DATABASE_URL:**
```
postgresql://neondb_owner:npg_3XrzHPCy4KLM@ep-hidden-cell-adcoofcw-pooler.c-2.us-east-1.aws.neon.tech/miru?sslmode=require
```

## 🚀 Pasos para Migrar

### Paso 1: Configurar DATABASE_URL en Render

1. Ve a tu dashboard de Render
2. Selecciona tu servicio
3. Ve a "Environment"
4. Agrega/actualiza:
   ```
   DATABASE_URL=postgresql://neondb_owner:npg_3XrzHPCy4KLM@ep-hidden-cell-adcoofcw-pooler.c-2.us-east-1.aws.neon.tech/miru?sslmode=require
   ```
5. (Opcional) Elimina `MONGODB_URI` si existe

### Paso 2: Ejecutar Migración de Prisma

**Localmente:**
```bash
# Generar Prisma Client con el nuevo schema
npm run prisma:generate

# Crear migración inicial
npx prisma migrate dev --name init_postgresql

# Aplicar migración
npx prisma migrate deploy
```

**En Render (automático):**
El comando `npm run build` ejecuta `prisma generate`, que generará el cliente con el nuevo schema.

**Crear tablas manualmente en Neon:**
Si necesitas crear las tablas manualmente, ejecuta las migraciones desde tu máquina local o usa Prisma Studio:
```bash
npx prisma studio
```

### Paso 3: Verificar Conexión

Después del deploy, verifica que la conexión funciona:
```bash
# En los logs de Render deberías ver:
✅ Prisma conectado a PostgreSQL
```

## ⚠️ Notas Importantes

1. **Datos Existentes**: Si tienes datos en MongoDB, necesitarás crear un script de migración para transferirlos a PostgreSQL.

2. **IDs**: Los IDs cambiarán de ObjectId a UUID. Esto puede afectar referencias en otros sistemas.

3. **Relaciones**: Los datos que estaban embebidos ahora están en tablas separadas con relaciones.

4. **Backup**: Asegúrate de hacer backup de tus datos antes de migrar.

## 🔍 Estructura de Tablas

### `usuarios`
- `id` (UUID, PK)
- `nombre`, `email`, `telefono`, etc.
- Relaciones opcionales: `preguntaSeguridad`, `direccion`, `perfilCapilar`

### `preguntas_seguridad`
- `id` (UUID, PK)
- `usuarioId` (UUID, FK → usuarios.id)
- `pregunta` (String)
- `respuesta` (String, hasheada)

### `direcciones`
- `id` (UUID, PK)
- `usuarioId` (UUID, FK → usuarios.id)
- `calle`, `numero`, `colonia`, `ciudad`, `estado`, `codigoPostal`

### `perfiles_capilares`
- `id` (UUID, PK)
- `usuarioId` (UUID, FK → usuarios.id)
- `tipoCabello`, `colorNatural`, `colorActual`, etc.

## 📝 Comandos Útiles

```bash
# Ver estado de migraciones
npx prisma migrate status

# Resetear base de datos (¡CUIDADO! Elimina todos los datos)
npx prisma migrate reset

# Generar Prisma Client
npm run prisma:generate

# Abrir Prisma Studio (interfaz visual)
npx prisma studio
```

## ✅ Checklist de Migración

- [ ] Actualizar `DATABASE_URL` en Render
- [ ] Eliminar `MONGODB_URI` si existe
- [ ] Ejecutar migraciones de Prisma
- [ ] Verificar conexión en logs de Render
- [ ] Probar endpoints principales:
  - [ ] `/api/auth/test`
  - [ ] `/api/auth/google`
  - [ ] `/api/pregunta-seguridad`
  - [ ] `/api/usuarios/registrar`
- [ ] (Si aplica) Migrar datos existentes de MongoDB a PostgreSQL

