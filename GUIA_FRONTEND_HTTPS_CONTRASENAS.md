# 🔒 Guía Frontend: Asegurar Contraseñas Cifradas en Tránsito

## 📋 Resumen

**En la mayoría de los casos, NO necesitas hacer cambios** si tu frontend ya está desplegado en HTTPS (como Vercel). Sin embargo, debes verificar que estés usando URLs HTTPS para todas las peticiones al backend.

## ✅ Verificación Rápida

### ¿Necesitas hacer cambios?

**NO necesitas cambios si:**
- ✅ Tu frontend está desplegado en HTTPS (Vercel lo hace automáticamente)
- ✅ Tus peticiones al backend usan `https://`
- ✅ No estás usando `http://` en producción

**SÍ necesitas cambios si:**
- ❌ Estás usando `http://miru-franco.onrender.com` en producción
- ❌ Tienes URLs hardcodeadas con HTTP
- ❌ No estás usando variables de entorno para la URL del API

## 🔍 Cómo Verificar

### 1. Verificar URLs del API

Busca en tu código donde configuras la URL del backend:

**Ejemplos comunes:**
```jsx
// ❌ MAL - HTTP en producción
const API_URL = 'http://miru-franco.onrender.com/api';

// ✅ BIEN - HTTPS
const API_URL = 'https://miru-franco.onrender.com/api';
```

**Con variables de entorno:**
```jsx
// ✅ BIEN - Usa variable de entorno
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';
```

### 2. Verificar Archivos de Configuración

Busca estos archivos en tu frontend:

#### Next.js
- `.env.local`
- `.env.production`
- `next.config.js`

#### React/Vite
- `.env`
- `.env.production`
- `vite.config.js`

#### React Create React App
- `.env`
- `.env.production`

**Verifica que contengan:**
```bash
# ✅ BIEN
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com/api

# ❌ MAL
NEXT_PUBLIC_API_URL=http://miru-franco.onrender.com/api
```

### 3. Verificar en el Código

Busca estas palabras clave en tu código:

```bash
# Buscar URLs del API
grep -r "miru-franco.onrender.com" src/
grep -r "API_URL" src/
grep -r "api/" src/
grep -r "baseURL" src/
```

**Verifica que:**
- ✅ Todas las URLs usen `https://`
- ✅ No haya URLs hardcodeadas con `http://`
- ✅ Las variables de entorno estén configuradas correctamente

## 🔧 Si Necesitas Hacer Cambios

### Opción 1: Actualizar Variable de Entorno

**Next.js:**
```bash
# .env.local o .env.production
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com/api
```

**React/Vite:**
```bash
# .env o .env.production
VITE_API_URL=https://miru-franco.onrender.com/api
```

**React Create React App:**
```bash
# .env o .env.production
REACT_APP_API_URL=https://miru-franco.onrender.com/api
```

### Opción 2: Actualizar Configuración de Axios

```jsx
// utils/axios.js o config/api.js
import axios from 'axios';

const api = axios.create({
  // ✅ Asegúrate de usar HTTPS
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
```

### Opción 3: Actualizar URLs Hardcodeadas

Si encuentras URLs hardcodeadas:

**Antes:**
```jsx
// ❌ MAL
const response = await fetch('http://miru-franco.onrender.com/api/usuarios/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
```

**Después:**
```jsx
// ✅ BIEN
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';
const response = await fetch(`${API_URL}/usuarios/login`, {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
```

## 🧪 Cómo Verificar que Funciona

### Prueba 1: Verificar en DevTools

1. **Abre tu frontend en producción:**
   - Ve a: `https://miru-franco.vercel.app` (o tu URL)

2. **Abre DevTools:**
   - Presiona `F12` o `Ctrl+Shift+I`
   - Ve a la pestaña **Network**

3. **Haz una petición:**
   - Inicia sesión o haz cualquier petición al backend

4. **Verifica la petición:**
   - Busca la petición al backend
   - Haz clic en ella
   - Ve a la pestaña **Headers**

5. **Resultado esperado:**
   - ✅ **Request URL:** `https://miru-franco.onrender.com/api/...`
   - ✅ **Protocol:** `h2` o `http/2`
   - ✅ **Scheme:** `https`
   - ✅ **Security:** "Secure" (candado verde)

### Prueba 2: Verificar Variables de Entorno

```bash
# En tu proyecto frontend
# Verificar que la variable esté configurada
echo $NEXT_PUBLIC_API_URL  # Next.js
# O
echo $VITE_API_URL  # Vite
# O
echo $REACT_APP_API_URL  # Create React App
```

**Resultado esperado:**
```
https://miru-franco.onrender.com/api
```

### Prueba 3: Verificar en el Código

```jsx
// Agregar temporalmente para debug
console.log('API URL:', process.env.NEXT_PUBLIC_API_URL);
console.log('Full URL:', `${process.env.NEXT_PUBLIC_API_URL}/usuarios/login`);
```

**Resultado esperado:**
```
API URL: https://miru-franco.onrender.com/api
Full URL: https://miru-franco.onrender.com/api/usuarios/login
```

## 📝 Ejemplos de Configuración Correcta

### Next.js

**`.env.production`:**
```bash
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com/api
```

**`utils/axios.js`:**
```jsx
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
```

### React con Vite

**`.env.production`:**
```bash
VITE_API_URL=https://miru-franco.onrender.com/api
```

**`src/config/api.js`:**
```jsx
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
```

### React Create React App

**`.env.production`:**
```bash
REACT_APP_API_URL=https://miru-franco.onrender.com/api
```

**`src/config/api.js`:**
```jsx
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
```

## ⚠️ Errores Comunes

### Error 1: Mixed Content

**Síntoma:**
```
Mixed Content: The page was loaded over HTTPS, but requested an insecure resource 'http://...'
```

**Causa:**
- Estás usando `http://` en un sitio HTTPS

**Solución:**
- Cambiar todas las URLs a `https://`

### Error 2: CORS Error

**Síntoma:**
```
Access to fetch at 'http://...' from origin 'https://...' has been blocked by CORS policy
```

**Causa:**
- Estás usando HTTP cuando el frontend está en HTTPS

**Solución:**
- Cambiar URL del backend a HTTPS

### Error 3: Certificado Inválido

**Síntoma:**
```
NET::ERR_CERT_AUTHORITY_INVALID
```

**Causa:**
- El certificado SSL del backend no es válido (raro con Render)

**Solución:**
- Verificar que el backend esté desplegado correctamente
- Verificar certificado en SSL Labs

## ✅ Checklist

- [ ] Verificar que todas las URLs del API usen `https://`
- [ ] Verificar variables de entorno configuradas con HTTPS
- [ ] Verificar que no haya URLs hardcodeadas con HTTP
- [ ] Verificar en DevTools que las peticiones usen HTTPS
- [ ] Verificar que no haya errores de Mixed Content
- [ ] Verificar que el frontend esté desplegado en HTTPS

## 🎯 Resumen

### ¿Necesitas hacer cambios?

**Probablemente NO**, si:
- ✅ Tu frontend ya está en Vercel (HTTPS automático)
- ✅ Ya estás usando `https://miru-franco.onrender.com` en tus peticiones
- ✅ No tienes URLs hardcodeadas con HTTP

**SÍ necesitas verificar:**
- ✅ Que todas las URLs del API usen HTTPS
- ✅ Que las variables de entorno estén configuradas correctamente
- ✅ Que no haya URLs hardcodeadas con HTTP

### Acción Recomendada

1. **Buscar en tu código:**
   ```bash
   # Buscar URLs del backend
   grep -r "miru-franco.onrender.com" src/
   grep -r "http://" src/
   ```

2. **Verificar variables de entorno:**
   - Asegúrate de que usen HTTPS

3. **Probar en producción:**
   - Abre DevTools → Network
   - Verifica que las peticiones usen HTTPS

## 🔒 Importante

**El cifrado en tránsito es automático cuando:**
- ✅ El frontend está en HTTPS (Vercel lo hace automáticamente)
- ✅ El backend está en HTTPS (Render lo hace automáticamente)
- ✅ Las peticiones usan URLs HTTPS

**No necesitas código adicional** para cifrar las contraseñas. HTTPS/TLS lo hace automáticamente.

## 📝 Conclusión

**En la mayoría de los casos, NO necesitas hacer cambios** si ya estás usando HTTPS. Solo verifica que:

1. ✅ Todas las URLs del API usen `https://`
2. ✅ Las variables de entorno estén configuradas correctamente
3. ✅ No haya URLs hardcodeadas con HTTP

Si todo esto está correcto, **las contraseñas ya están cifradas en tránsito automáticamente** gracias a HTTPS/TLS. 🎉

