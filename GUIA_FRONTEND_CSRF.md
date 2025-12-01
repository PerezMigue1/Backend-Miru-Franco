# 🛡️ Guía Frontend: Integrar Protección CSRF con el Backend

## 📋 Resumen

El backend ya tiene protección **CSRF** activada para rutas sensibles (`/api/usuarios/*`, `/api/auth/*`) mediante:

- `CsrfMiddleware`: genera y expone un token CSRF
- `CsrfGuard`: exige que las peticiones **POST/PUT/DELETE/PATCH** incluyan un token CSRF válido

**Tu tarea en el frontend** es:

1. Obtener el token CSRF desde el backend (vía `GET`)
2. Enviar ese token en el header `X-CSRF-Token` en todas las peticiones que modifican datos

---

## 🔐 Cómo funciona el CSRF en el backend

- En cada `GET` (por ejemplo, al cargar la app):
  - El backend genera un token aleatorio si no existe
  - Lo envía en:
    - Header: `X-CSRF-Token`
    - Cookie: `csrf-token`

- En cada `POST/PUT/DELETE/PATCH`:
  - El `CsrfGuard` compara:
    - Header: `X-CSRF-Token` enviado por el frontend
    - Cookie: `csrf-token` generada por el backend
  - Si no coinciden → `403 Token CSRF inválido o faltante`

---

## 🧩 Paso 1: Obtener el token CSRF

### Opción A: Next.js (recomendado)

```tsx
// utils/csrf.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';

export async function fetchCsrfToken(): Promise<string | null> {
  try {
    // Hacemos un GET a cualquier endpoint que no requiera auth
    const response = await fetch(`${API_BASE_URL.replace(/\/api$/, '')}/`, {
      method: 'GET',
      credentials: 'include', // Importante: para recibir cookies (csrf-token)
    });

    // Leer el header X-CSRF-Token
    const csrfToken = response.headers.get('X-CSRF-Token');

    if (csrfToken) {
      // Guardar en memoria/localStorage según tu preferencia
      localStorage.setItem('csrfToken', csrfToken);
      return csrfToken;
    }

    return null;
  } catch (error) {
    console.error('Error obteniendo CSRF token:', error);
    return null;
  }
}
```

**¿Cuándo llamarlo?**

- Al iniciar la app (por ejemplo, en `_app.tsx` o en un `Layout` principal)

```tsx
// pages/_app.tsx
import { useEffect } from 'react';
import { fetchCsrfToken } from '../utils/csrf';

function MyApp({ Component, pageProps }) {
  useEffect(() => {
    fetchCsrfToken();
  }, []);

  return <Component {...pageProps} />;
}

export default MyApp;
```

---

## 🧩 Paso 2: Enviar el token CSRF en cada petición

### Con Axios (recomendado)

```tsx
// utils/axios.ts
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api',
  withCredentials: true, // Importante: para enviar cookies (csrf-token)
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor de request para adjuntar el token CSRF
api.interceptors.request.use(
  (config) => {
    // Solo agregar CSRF a métodos que modifican datos
    const method = (config.method || 'get').toUpperCase();
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (needsCsrf) {
      const csrfToken = typeof window !== 'undefined'
        ? localStorage.getItem('csrfToken')
        : null;

      if (csrfToken) {
        config.headers = config.headers || {};
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }

    return config;
  },
  (error) => Promise.reject(error),
);

export default api;
```

### Con fetch

```tsx
// utils/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';

export async function apiRequest(path: string, options: RequestInit = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (needsCsrf && typeof window !== 'undefined') {
    const csrfToken = localStorage.getItem('csrfToken');
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Importante para cookies
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw { response, data };
  }

  return data;
}

// Uso:
// await apiRequest('/usuarios/registro', { method: 'POST', body: JSON.stringify(data) });
```

---

## 🧪 Cómo Probar (desde el frontend)

### Prueba 1: Petición sin CSRF (debería fallar en producción)

1. Desactiva temporalmente el envío de `X-CSRF-Token` en el frontend (comenta la parte del header).
2. Intenta hacer un `POST` a `/api/usuarios/registro` o `/api/usuarios/login` desde el frontend.

**Resultado esperado en producción (`NODE_ENV=production`):**

- Status: `403 Forbidden`
- Mensaje: `"Token CSRF inválido o faltante"`

En desarrollo (`NODE_ENV !== 'production'`), el guard permite pasar si no hay cookie, para no bloquear tu trabajo local.

---

### Prueba 2: Petición con CSRF (debe funcionar)

1. Asegúrate de llamar a `fetchCsrfToken()` al iniciar la app.
2. Verifica en DevTools → Network que el GET inicial incluye el header `X-CSRF-Token` y que se setea la cookie `csrf-token`.
3. Haz un `POST` de registro o login desde el frontend.

**Resultado esperado:**

- Status: `200/201` según el caso.
- No se devuelve el error de CSRF.

---

## 🔍 Verificación en DevTools

1. Abre tu frontend desplegado (`https://tu-frontend.vercel.app`).
2. Abre DevTools (`F12`) → pestaña **Network**.
3. Recarga la página:
   - Busca la primera petición `GET` al backend (`/` o `/api/salud`).
   - Verifica en **Response Headers** que aparece `X-CSRF-Token`.
   - Verifica en **Cookies** que existe `csrf-token`.
4. Haz un `POST` de login o registro:
   - En **Request Headers** debe aparecer:
     - `X-CSRF-Token: <valor>`
   - En **Cookies** sigue estando `csrf-token`.

---

## 📋 Checklist para el frontend

- [ ] Llamar a un `GET` al backend al iniciar (para obtener `X-CSRF-Token`).
- [ ] Guardar el token en `localStorage` (o estado global).
- [ ] Enviar `X-CSRF-Token` en todas las peticiones `POST/PUT/PATCH/DELETE`.
- [ ] Usar `credentials: 'include'` (fetch) o `withCredentials: true` (Axios) para enviar cookies.
- [ ] Verificar en DevTools que:
  - El GET inicial incluye `X-CSRF-Token` en **Response Headers**.
  - Las peticiones POST incluyen `X-CSRF-Token` en **Request Headers**.

---

## ❓ Notas y Preguntas Frecuentes

### ¿Tengo que hacer algo especial con cookies?

No directamente. El backend maneja la cookie `csrf-token`. Solo asegúrate de:

- Usar `credentials: 'include'` (fetch) o `withCredentials: true` (Axios).

### ¿Qué pasa en desarrollo (localhost)?

En desarrollo (`NODE_ENV !== 'production'`):

- Si no hay cookie `csrf-token`, el guard permite pasar para no bloquear.
- Aun así, puedes probar el flujo completo si quieres.

### ¿Afecta a Postman o pruebas manuales?

Sí, en producción:

- Para `POST` deberás:
  1. Hacer primero un `GET` y copiar `X-CSRF-Token` y la cookie `csrf-token`.
  2. En el `POST`, enviar:
     - Header: `X-CSRF-Token: <valor>`
     - Cookie: `csrf-token=<valor>`

---

## ✅ Resumen Final

1. **Backend** ya genera y valida tokens CSRF.
2. **Frontend** debe:
   - Obtener el token con un `GET` (lee `X-CSRF-Token`).
   - Guardarlo (ej: `localStorage`).
   - Enviar `X-CSRF-Token` en las peticiones que modifican datos.
3. Con esto, las peticiones `POST/PUT/PATCH/DELETE` sensibles quedan protegidas contra CSRF.


