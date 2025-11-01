# 🚀 Configuración de Vercel para Backend Miru

## ✅ Paso 1: Configurar Variable de Entorno en Vercel

Ve a tu proyecto en Vercel: https://vercel.com/miru-franco/backend-miru-franco

1. **Clic en "Settings"** (Configuración)
2. **Clic en "Environment Variables"** (Variables de Entorno)
3. **Añade la siguiente variable:**

```
Key: MONGODB_URI
Value: mongodb+srv://miru:mildred30%3E@mirufranco.rsucbbc.mongodb.net/mirufranco?retryWrites=true&w=majority&appName=MiruFranco
```

**⚠️ Importante:** El carácter `>` en la contraseña debe codificarse como `%3E`

4. **Selecciona todos los entornos:** Production, Preview, Development
5. **Haz clic en "Save"** (Guardar)

## 🔄 Paso 2: Redesplegar tu Aplicación

Después de agregar la variable de entorno:

1. Ve a la pestaña **"Deployments"** (Despliegues)
2. Haz clic en los **tres puntos** al lado del deployment más reciente
3. Selecciona **"Redeploy"** (Redesplegar)
4. Confirma el redespliegue

## ✅ Paso 3: Verificar que Funciona

Una vez redesplegado, tu backend debería estar disponible en:

**URL del Backend:** `https://backend-miru-franco.vercel.app`

### Probar la API:

1. **Verificar estado:**
   ```bash
   curl https://backend-miru-franco.vercel.app/
   ```

2. **Obtener usuarios:**
   ```bash
   curl https://backend-miru-franco.vercel.app/api/users
   ```

3. **Crear un usuario:**
   ```bash
   curl -X POST https://backend-miru-franco.vercel.app/api/users \
     -H "Content-Type: application/json" \
     -d '{"name": "Test User", "email": "test@example.com"}'
   ```

## 📝 Configuración del Frontend

Ahora necesitas configurar tu frontend Next.js para que use esta API.

### En tu proyecto `miru-franco-web`:

1. **Crear archivo `.env.local`:**

```env
# URL de tu backend API
NEXT_PUBLIC_API_URL=https://backend-miru-franco.vercel.app/api

# URL de la aplicación frontend
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

2. **Para producción (Vercel), también configura:**
   - Ve a tu proyecto de frontend en Vercel
   - Settings → Environment Variables
   - Añade las mismas variables con las URLs de producción

## 🔗 URLs Importantes

- **Backend:** `https://backend-miru-franco.vercel.app`
- **Frontend (dev):** `http://localhost:3000`
- **Frontend (prod):** `https://miru-franco.vercel.app` (actualiza con tu URL real)

## ⚠️ Nota Importante

Si Vercel cambia la URL de tu backend, actualiza las URLs en:
- Variables de entorno del frontend
- Configuración de CORS en el backend (si es necesario)

## 🔍 Verificar Logs

Para ver los logs de tu backend en Vercel:

1. Ve a tu proyecto
2. Pestaña **"Deployments"**
3. Haz clic en el deployment más reciente
4. Ve a la pestaña **"Functions"**
5. Haz clic en cualquier función para ver los logs

---

¿Necesitas ayuda? Revisa la pestaña de logs en Vercel si hay errores.

