# 🔄 Guía: Actualizar Frontend para OAuth2.0 Seguro

## ⚠️ IMPORTANTE: Cambio Requerido

El backend ahora usa **Authorization Code Flow** en lugar de pasar el token directamente en la URL. **Debes actualizar tu frontend** para que funcione correctamente.

## 🔍 ¿Qué Cambió?

### ❌ ANTES (Inseguro - Ya no funciona así)
```jsx
// El token venía directamente en la URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
localStorage.setItem('token', token);
```

### ✅ AHORA (Seguro)
```jsx
// Ahora viene un código temporal que debes intercambiar por el token
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');

// Intercambiar código por token
const response = await fetch('/api/auth/exchange-code', {
  method: 'POST',
  body: JSON.stringify({ code }),
});
const { token } = await response.json();
localStorage.setItem('token', token);
```

## 📝 Instrucciones Paso a Paso

### Paso 1: Identificar tu Página de Callback

Busca el archivo que maneja la redirección después de OAuth. Probablemente se llama:
- `pages/auth/callback.jsx` (Next.js)
- `pages/auth/callback.tsx` (Next.js con TypeScript)
- `components/AuthCallback.jsx` (React)
- `routes/auth/callback.jsx` (React Router)

### Paso 2: Actualizar el Código

#### Opción A: Si usas Next.js

```jsx
// pages/auth/callback.jsx o pages/auth/callback.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/axios'; // O tu configuración de API

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      const { code, error: errorParam } = router.query;

      // Si hay error de OAuth (ej: usuario canceló)
      if (errorParam) {
        setError('Error en la autenticación. Por favor intenta de nuevo.');
        setLoading(false);
        setTimeout(() => router.push('/login'), 3000);
        return;
      }

      // Si hay código, intercambiarlo por token
      if (code) {
        try {
          const response = await api.post('/auth/exchange-code', { 
            code: code as string 
          });
          
          if (response.data.success && response.data.token) {
            // Guardar token
            localStorage.setItem('token', response.data.token);
            
            // Opcional: Guardar información del usuario si viene en la respuesta
            if (response.data.user) {
              localStorage.setItem('user', JSON.stringify(response.data.user));
            }
            
            // Redirigir al dashboard o página principal
            router.push('/dashboard');
            // O router.push('/');
          } else {
            setError('Error al obtener token');
            setLoading(false);
            setTimeout(() => router.push('/login'), 3000);
          }
        } catch (error: any) {
          console.error('Error intercambiando código:', error);
          setError(
            error.response?.data?.message || 
            'Error al intercambiar código por token'
          );
          setLoading(false);
          setTimeout(() => router.push('/login'), 3000);
        }
      } else {
        // No hay código ni error, redirigir al login
        setError('Código de autenticación no proporcionado');
        setLoading(false);
        setTimeout(() => router.push('/login'), 3000);
      }
    };

    // Esperar a que router esté listo
    if (router.isReady) {
      handleCallback();
    }
  }, [router.isReady, router.query]);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>
          <p>Procesando autenticación...</p>
          <div>⏳</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column'
      }}>
        <div style={{ color: 'red', marginBottom: '10px' }}>
          ⚠️ {error}
        </div>
        <p>Redirigiendo al login...</p>
      </div>
    );
  }

  return null;
}
```

#### Opción B: Si usas React Router

```jsx
// components/AuthCallback.jsx o routes/auth/callback.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/axios'; // O tu configuración de API

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const errorParam = searchParams.get('error');

      // Si hay error de OAuth
      if (errorParam) {
        setError('Error en la autenticación. Por favor intenta de nuevo.');
        setLoading(false);
        setTimeout(() => navigate('/login'), 3000);
        return;
      }

      // Si hay código, intercambiarlo por token
      if (code) {
        try {
          const response = await api.post('/auth/exchange-code', { code });
          
          if (response.data.success && response.data.token) {
            // Guardar token
            localStorage.setItem('token', response.data.token);
            
            // Opcional: Guardar información del usuario
            if (response.data.user) {
              localStorage.setItem('user', JSON.stringify(response.data.user));
            }
            
            // Redirigir al dashboard
            navigate('/dashboard');
          } else {
            setError('Error al obtener token');
            setLoading(false);
            setTimeout(() => navigate('/login'), 3000);
          }
        } catch (error: any) {
          console.error('Error intercambiando código:', error);
          setError(
            error.response?.data?.message || 
            'Error al intercambiar código por token'
          );
          setLoading(false);
          setTimeout(() => navigate('/login'), 3000);
        }
      } else {
        setError('Código de autenticación no proporcionado');
        setLoading(false);
        setTimeout(() => navigate('/login'), 3000);
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>
          <p>Procesando autenticación...</p>
          <div>⏳</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column'
      }}>
        <div style={{ color: 'red', marginBottom: '10px' }}>
          ⚠️ {error}
        </div>
        <p>Redirigiendo al login...</p>
      </div>
    );
  }

  return null;
}
```

#### Opción C: Si usas Fetch directamente (sin Axios)

```jsx
// pages/auth/callback.jsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      const { code, error: errorParam } = router.query;

      if (errorParam) {
        setError('Error en la autenticación');
        setLoading(false);
        setTimeout(() => router.push('/login'), 3000);
        return;
      }

      if (code) {
        try {
          const response = await fetch(`${API_URL}/auth/exchange-code`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code }),
          });

          const data = await response.json();

          if (response.ok && data.success && data.token) {
            localStorage.setItem('token', data.token);
            router.push('/dashboard');
          } else {
            setError(data.message || 'Error al obtener token');
            setLoading(false);
            setTimeout(() => router.push('/login'), 3000);
          }
        } catch (error) {
          console.error('Error:', error);
          setError('Error de conexión');
          setLoading(false);
          setTimeout(() => router.push('/login'), 3000);
        }
      } else {
        setError('Código no proporcionado');
        setLoading(false);
        setTimeout(() => router.push('/login'), 3000);
      }
    };

    if (router.isReady) {
      handleCallback();
    }
  }, [router.isReady, router.query]);

  // ... resto del componente igual que arriba
}
```

### Paso 3: Configurar la URL de la API

Asegúrate de que tu configuración de API apunte al backend correcto:

```jsx
// utils/axios.js o config/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
```

O si usas variables de entorno:

```bash
# .env.local (Next.js)
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com/api
```

### Paso 4: Verificar la Ruta

Asegúrate de que la ruta `/auth/callback` esté configurada correctamente:

**Next.js:**
- Archivo: `pages/auth/callback.jsx` o `pages/auth/callback.tsx`
- Ruta automática: `/auth/callback`

**React Router:**
```jsx
// App.jsx o routes.jsx
import AuthCallback from './components/AuthCallback';

<Route path="/auth/callback" element={<AuthCallback />} />
```

## 🧪 Cómo Probar

### 1. Probar el Flujo Completo

1. **Iniciar sesión con Google:**
   - Haz clic en "Continuar con Google"
   - Debe redirigir a Google

2. **Autenticar en Google:**
   - Inicia sesión con tu cuenta de Google
   - Google redirigirá de vuelta

3. **Verificar la URL:**
   - Debe ser: `https://tu-frontend.com/auth/callback?code=ABC123...`
   - ✅ Debe tener `code=`
   - ❌ NO debe tener `token=`

4. **Verificar el intercambio:**
   - Abre DevTools → Network
   - Debe aparecer una petición `POST /api/auth/exchange-code`
   - Debe retornar `{ success: true, token: "..." }`

5. **Verificar redirección:**
   - Debe redirigir a `/dashboard` o la página principal
   - El token debe estar en `localStorage`

### 2. Probar Manejo de Errores

**Error 1: Código expirado**
- Espera más de 5 minutos después de obtener el código
- Intenta usar el código
- Debe mostrar error y redirigir al login

**Error 2: Código inválido**
- Modifica el código en la URL
- Debe mostrar error y redirigir al login

**Error 3: Usuario cancela OAuth**
- Cancela la autenticación en Google
- Debe mostrar error y redirigir al login

## 🔍 Verificar que Funciona

### Checklist

- [ ] El código lee `code` de la URL (no `token`)
- [ ] Hace POST a `/api/auth/exchange-code` con el código
- [ ] Guarda el token en `localStorage`
- [ ] Redirige al dashboard después de éxito
- [ ] Muestra mensaje de error si falla
- [ ] Redirige al login si hay error

### Código de Verificación Rápida

Agrega esto temporalmente para debug:

```jsx
useEffect(() => {
  console.log('🔍 URL params:', router.query);
  console.log('🔍 Code:', router.query.code);
}, [router.query]);
```

## ⚠️ Errores Comunes

### Error 1: "Código requerido"
**Causa:** No estás enviando el código en el body
**Solución:** Asegúrate de enviar `{ code: code }` en el body

### Error 2: "Código inválido"
**Causa:** El código no existe o ya fue usado
**Solución:** El código solo puede usarse una vez. Inicia sesión de nuevo.

### Error 3: "Código expirado"
**Causa:** Pasaron más de 5 minutos
**Solución:** Los códigos expiran rápido. Inicia sesión de nuevo.

### Error 4: CORS Error
**Causa:** El frontend no está en la lista de orígenes permitidos
**Solución:** Verifica que tu URL de frontend esté en `allowedOrigins` del backend

## 📝 Resumen de Cambios

### Antes:
```jsx
// ❌ INSEGURO
const token = urlParams.get('token');
localStorage.setItem('token', token);
```

### Después:
```jsx
// ✅ SEGURO
const code = urlParams.get('code');
const response = await api.post('/auth/exchange-code', { code });
localStorage.setItem('token', response.data.token);
```

## 🎯 Endpoint del Backend

**Nuevo endpoint:**
```
POST /api/auth/exchange-code
Content-Type: application/json

Body:
{
  "code": "a1b2c3d4e5f6..."
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## ✅ Después de Actualizar

Una vez actualizado, verifica:

1. ✅ El flujo de OAuth funciona
2. ✅ El token se guarda correctamente
3. ✅ Puedes hacer peticiones autenticadas
4. ✅ Los errores se manejan correctamente

## 🆘 ¿Necesitas Ayuda?

Si tienes problemas:

1. **Verifica la consola del navegador** para errores
2. **Verifica la pestaña Network** en DevTools
3. **Verifica que el código esté en la URL** después de OAuth
4. **Verifica que el endpoint `/api/auth/exchange-code` responda**

¡Con estos cambios, tu frontend estará usando OAuth2.0 de forma segura! 🎉

