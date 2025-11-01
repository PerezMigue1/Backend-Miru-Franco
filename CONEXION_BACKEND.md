# 🔌 Guía Paso a Paso: Conectar Frontend con Backend

Esta guía te ayudará a conectar tu frontend Next.js con tu backend Node.js/Express.

---

## 📋 Paso 1: Verificar la URL de tu Backend

Primero, identifica la URL donde está corriendo tu backend:

- **Desarrollo local:** `http://localhost:3001` (o el puerto que uses)
- **Producción:** `https://tu-backend.com` (o la URL donde esté desplegado)

### Ejemplo de estructura de tu backend:
```
Backend URL: http://localhost:3001
API Base: http://localhost:3001/api/auth
```

---

## 📝 Paso 2: Configurar Variables de Entorno en el Frontend

### 2.1 Crear archivo `.env.local`

En la raíz de tu proyecto `miru-franco-web`, crea un archivo llamado `.env.local`:

```env
# URL de tu backend API (desarrollo)
NEXT_PUBLIC_API_URL=http://localhost:3001/api/auth

# URL de la aplicación frontend (para enlaces de reset password)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**⚠️ Importante:** 
- El archivo `.env.local` ya está en `.gitignore`, así que no se subirá a Git
- Las variables que empiezan con `NEXT_PUBLIC_` son accesibles en el navegador

### 2.2 Verificar que el archivo se creó

Asegúrate de que el archivo `.env.local` esté en:
```
miru-franco-web/
  ├── .env.local    ← Aquí
  ├── package.json
  ├── src/
  └── ...
```

---

## 🔧 Paso 3: Configurar CORS en tu Backend

Para que el frontend pueda comunicarse con el backend, necesitas configurar CORS.

### 3.1 Instalar CORS (si no lo tienes)

En tu proyecto backend, ejecuta:

```bash
npm install cors
```

### 3.2 Configurar CORS en Express

En tu archivo principal del backend (normalmente `app.js` o `server.js`), agrega:

```javascript
const express = require('express');
const cors = require('cors');
const app = express();

// Configurar CORS
const corsOptions = {
  origin: [
    'http://localhost:3000',           // Frontend en desarrollo
    'https://tu-frontend.vercel.app'   // Frontend en producción (actualiza con tu URL)
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// ... resto de tu código
```

### 3.3 Permitir todas las URLs (solo para desarrollo)

Si quieres permitir todas las URLs durante desarrollo:

```javascript
app.use(cors({
  origin: '*',  // ⚠️ Solo para desarrollo, no usar en producción
  credentials: true
}));
```

---

## ✅ Paso 4: Verificar que los Endpoints del Backend Estén Correctos

Tu backend debe tener estos endpoints exactamente como se especifica en `BACKEND_API.md`:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/auth/register` | POST | Registrar usuario |
| `/api/auth/login` | POST | Iniciar sesión |
| `/api/auth/forgot-password` | POST | Solicitar recuperación |
| `/api/auth/reset-password` | POST | Restablecer contraseña |
| `/api/auth/verify-sms` | PUT | Enviar código SMS |
| `/api/auth/verify-sms` | POST | Verificar código SMS |
| `/api/auth/verify-security-questions` | GET | Obtener preguntas |
| `/api/auth/verify-security-questions` | POST | Verificar respuestas |

**Verifica que:**
- ✅ La ruta base sea `/api/auth`
- ✅ Los métodos HTTP sean los correctos (POST, GET, PUT)
- ✅ Las respuestas tengan el formato correcto (ver `BACKEND_API.md`)

---

## 🚀 Paso 5: Probar la Conexión

### 5.1 Iniciar el Backend

En la terminal de tu proyecto backend:

```bash
npm start
# o
node server.js
# o el comando que uses
```

Verifica que el backend esté corriendo en el puerto correcto:
```
Server running on http://localhost:3001
```

### 5.2 Iniciar el Frontend

En una **nueva terminal**, ve a tu proyecto frontend:

```bash
cd miru-franco-web
npm run dev
```

### 5.3 Probar el Registro

1. Abre tu navegador en `http://localhost:3000`
2. Haz clic en "Regístrate" o "Crear Cuenta"
3. Completa el formulario
4. Haz clic en "Crear Cuenta"

**Verifica:**
- ✅ La petición aparece en la consola del backend
- ✅ No hay errores de CORS en la consola del navegador (F12)
- ✅ El usuario se crea correctamente

### 5.4 Revisar la Consola del Navegador

Abre las herramientas de desarrollador (F12) y ve a la pestaña **Network**:
- Deberías ver las peticiones a `http://localhost:3001/api/auth/...`
- Si hay errores, revisa la pestaña **Console**

---

## 🐛 Paso 6: Solucionar Problemas Comunes

### Error: "Network Error" o "Failed to fetch"

**Causa:** El backend no está corriendo o CORS no está configurado.

**Solución:**
1. Verifica que el backend esté corriendo
2. Verifica que la URL en `.env.local` sea correcta
3. Asegúrate de que CORS esté configurado en el backend

### Error: "CORS policy blocked"

**Causa:** El backend no permite solicitudes desde el frontend.

**Solución:**
1. Verifica la configuración de CORS en el backend
2. Asegúrate de incluir `http://localhost:3000` en `origin`
3. Reinicia el servidor backend después de cambiar CORS

### Error: "404 Not Found"

**Causa:** La ruta del endpoint no coincide.

**Solución:**
1. Verifica que las rutas en el backend sean `/api/auth/...`
2. Verifica que `NEXT_PUBLIC_API_URL` termine en `/api/auth`
3. Revisa las rutas en `src/lib/api.ts` del frontend

### Error: "401 Unauthorized"

**Causa:** El token JWT no se está enviando correctamente.

**Solución:**
1. Verifica que el login funcione correctamente
2. Verifica que el token se guarde en `localStorage`
3. Revisa los headers de las peticiones en Network tab

---

## 🌐 Paso 7: Configurar para Producción

### 7.1 Variables de Entorno en Vercel

Cuando despliegues el frontend en Vercel:

1. Ve a tu proyecto en Vercel
2. **Settings** → **Environment Variables**
3. Agrega:

```
NEXT_PUBLIC_API_URL = https://tu-backend.com/api/auth
NEXT_PUBLIC_APP_URL = https://tu-frontend.vercel.app
```

**⚠️ Importante:** 
- Reemplaza `https://tu-backend.com` con la URL real de tu backend
- Reemplaza `https://tu-frontend.vercel.app` con la URL real de Vercel

### 7.2 Actualizar CORS en Producción

En tu backend, actualiza la configuración de CORS para incluir la URL de producción:

```javascript
const corsOptions = {
  origin: [
    'http://localhost:3000',                      // Desarrollo
    'https://tu-frontend.vercel.app',            // Producción
    'https://miru-franco.vercel.app'             // Tu URL real
  ],
  credentials: true,
  optionsSuccessStatus: 200
};
```

### 7.3 Verificar que Funcione

1. Haz deploy del frontend en Vercel
2. Prueba registrarte desde la URL de producción
3. Verifica que las peticiones lleguen al backend
4. Revisa los logs en ambos servicios si hay errores

---

## 📊 Paso 8: Verificar que Todo Funcione

### Checklist de Verificación:

- [ ] Backend corriendo en `http://localhost:3001`
- [ ] Frontend corriendo en `http://localhost:3000`
- [ ] Archivo `.env.local` creado con `NEXT_PUBLIC_API_URL`
- [ ] CORS configurado en el backend
- [ ] Puedo registrarme desde el frontend
- [ ] Puedo iniciar sesión
- [ ] Puedo recuperar mi contraseña
- [ ] No hay errores en la consola del navegador
- [ ] Las peticiones aparecen en el backend

---

## 🔍 Paso 9: Depuración y Logs

### Ver peticiones del Frontend

En el navegador (F12):
- **Network tab:** Ver todas las peticiones HTTP
- **Console tab:** Ver errores y logs

### Ver peticiones en el Backend

Agrega logs en tu backend para ver las peticiones:

```javascript
app.use('/api/auth', (req, res, next) => {
  console.log(`${req.method} ${req.path}`, req.body);
  next();
});
```

---

## 📞 Resumen de URLs Importantes

**Desarrollo:**
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`
- API Base: `http://localhost:3001/api/auth`

**Producción:**
- Frontend: `https://tu-frontend.vercel.app`
- Backend: `https://tu-backend.com`
- API Base: `https://tu-backend.com/api/auth`

---

## ✅ Siguiente Paso

Una vez que verifiques que todo funciona en desarrollo:

1. Despliega tu backend en producción (Railway, Render, Heroku, etc.)
2. Actualiza las variables de entorno en Vercel
3. Actualiza CORS en el backend para incluir la URL de producción
4. Prueba todo en producción

---

## 🆘 ¿Necesitas Ayuda?

Si encuentras algún problema:

1. Revisa la consola del navegador (F12)
2. Revisa los logs del backend
3. Verifica que las URLs sean correctas
4. Verifica que CORS esté configurado
5. Compara tu implementación con `BACKEND_API.md`

