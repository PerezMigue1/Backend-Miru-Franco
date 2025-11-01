# 🔐 Variables de Entorno para Vercel

## ✅ Variables OBLIGATORIAS (Debes agregarlas)

### 1. MONGODB_URI (CRÍTICO)
```
Key: MONGODB_URI
Value: mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
```

**Descripción:** Connection string de MongoDB Atlas. Sin esto, el backend NO funcionará.

**⚠️ Nota:** Base de datos: `estetica-miru-franco`

---

### 2. JWT_SECRET (CRÍTICO para autenticación)
```
Key: JWT_SECRET
Value: [genera un string largo y aleatorio]
```

**Recomendación:** Genera un secret seguro. Puedes usar:
- **Node.js:** `require('crypto').randomBytes(64).toString('hex')`
- **Online:** https://randomkeygen.com/ (usa "CodeIgniter Encryption Keys")
- **PowerShell:** `[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))`

**Ejemplo seguro:**
```
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6A7B8C9D0E1F2G3H4I5J6K7L8M9N0O1P2Q3R4S5T6U7V8W9X0Y1Z2
```

**Descripción:** Secreto para firmar y verificar tokens JWT. **NUNCA** uses el valor por defecto en producción.

---

## 🌐 Variables RECOMENDADAS (Opcionales pero útiles)

### 3. NODE_ENV
```
Key: NODE_ENV
Value: production
```
**Descripción:** Indica el entorno de ejecución. Vercel la establece automáticamente, pero puedes fijarla explícitamente.

---

### 4. FRONTEND_URL (Para CORS mejorado)
```
Key: FRONTEND_URL
Value: https://miru-franco.vercel.app
```
**Descripción:** URL de tu frontend Next.js en producción. Úsala para configurar CORS de forma más segura.

**Nota:** Si quieres restringir CORS solo a tu frontend, actualiza `server.js`:

```javascript
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
```

---

### 5. API_URL (Para logs y referencias)
```
Key: API_URL
Value: https://backend-miru-franco.vercel.app
```
**Descripción:** URL completa de tu API. Útil para logs y referencias internas.

---

## 🔒 Variables de SEGURIDAD (Opcionales - Futuras)

### 6. BCRYPT_ROUNDS (Si quieres personalizar)
```
Key: BCRYPT_ROUNDS
Value: 10
```
**Descripción:** Número de rondas para hashear contraseñas. Por defecto es 10 (ya está en el código).

---

### 7. JWT_EXPIRATION (Si quieres personalizar)
```
Key: JWT_EXPIRATION
Value: 1d
```
**Descripción:** Tiempo de expiración de los tokens JWT. Por defecto es '1d' (1 día).

---

## 📋 Instrucciones para Agregar en Vercel

### Paso a Paso:

1. **Ve a tu proyecto en Vercel:**
   ```
   https://vercel.com/miru-franco/backend-miru-franco
   ```

2. **Clic en "Settings"** → **"Environment Variables"**

3. **Agrega cada variable:**
   - Haz clic en **"Add New"**
   - Ingresa el **Key** y **Value**
   - Selecciona los entornos donde aplicará:
     - ☑️ **Production** (obligatorio)
     - ☑️ **Preview** (recomendado)
     - ☑️ **Development** (opcional)

4. **Clic en "Save"**

5. **Redesplega la aplicación:**
   - Ve a **"Deployments"**
   - Clic en los **tres puntos** del último deployment
   - Selecciona **"Redeploy"**

---

## ✅ Checklist Completo

### Variables Mínimas (Obligatorias):
- [ ] `MONGODB_URI` - Connection string de MongoDB
- [ ] `JWT_SECRET` - Secreto para tokens JWT

### Variables Recomendadas:
- [ ] `NODE_ENV=production` - Entorno de producción
- [ ] `FRONTEND_URL` - URL de tu frontend (para CORS)
- [ ] `API_URL` - URL de tu API (para referencia)

### Variables Opcionales:
- [ ] `BCRYPT_ROUNDS` - Solo si quieres cambiar el valor por defecto
- [ ] `JWT_EXPIRATION` - Solo si quieres cambiar el valor por defecto

---

## 🔐 Seguridad: Buenas Prácticas

### ✅ HACER:
- ✅ Usar valores diferentes para `JWT_SECRET` en desarrollo y producción
- ✅ Generar `JWT_SECRET` con al menos 64 caracteres aleatorios
- ✅ Revisar periódicamente que las variables no se hayan filtrado
- ✅ Usar diferentes bases de datos para desarrollo y producción

### ❌ NO HACER:
- ❌ Usar valores por defecto en producción
- ❌ Compartir tus variables de entorno en código público
- ❌ Usar la misma `MONGODB_URI` para desarrollo y producción
- ❌ Usar secretos cortos o predecibles

---

## 🧪 Verificar que Funcionen

Después de agregar las variables y redesplegar, verifica en los logs:

1. Ve a **Deployments** → Último deployment → **Functions** → `server.js`
2. Busca en los logs:
   - ✅ `✅ MongoDB conectado` - Confirma que `MONGODB_URI` funciona
   - ❌ Si ves errores de JWT, verifica `JWT_SECRET`

---

## 📝 Resumen Rápido

**Mínimo necesario para funcionar:**
```
MONGODB_URI=mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
JWT_SECRET=[tu_secreto_aleatorio_largo]
```

**Configuración completa recomendada:**
```
MONGODB_URI=mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
JWT_SECRET=[tu_secreto_aleatorio_largo]
NODE_ENV=production
FRONTEND_URL=https://miru-franco.vercel.app
API_URL=https://backend-miru-franco.vercel.app
```

---

## 🆘 Problemas Comunes

### Error: "MongoNetworkError" o "MongooseServerSelectionError"
**Causa:** `MONGODB_URI` incorrecta o no configurada
**Solución:** Verifica que el connection string esté correcto y que uses `%3E` en lugar de `>`

### Error: "JsonWebTokenError" o "invalid signature"
**Causa:** `JWT_SECRET` no configurado o incorrecto
**Solución:** Agrega/actualiza `JWT_SECRET` con un valor válido

### Error: "CORS policy blocked"
**Causa:** Frontend no está en la lista de orígenes permitidos
**Solución:** Agrega `FRONTEND_URL` y actualiza la configuración de CORS en `server.js`

