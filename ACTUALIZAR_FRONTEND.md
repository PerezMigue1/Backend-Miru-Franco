# 🔄 Guía: Actualizar Frontend para Backend en Render

## 📋 Cambios en el Backend

Tu backend ahora está en:
- **URL**: `https://miru-franco.onrender.com`
- **Base de Datos**: PostgreSQL (Neon) en lugar de MongoDB
- **Estructura**: Mismo formato de respuestas, solo cambió la base de datos

## ✅ Paso 1: Actualizar URL del Backend

### En Variables de Entorno (Vercel o donde despliegues)

Actualiza `NEXT_PUBLIC_API_URL` o la variable que uses:

```env
# ANTES (si tenías otra URL)
NEXT_PUBLIC_API_URL=https://backend-anterior.vercel.app

# AHORA
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com
```

**⚠️ Importante:** No debe tener barra final (`/`)

### En tu Código Frontend

Si tienes la URL hardcodeada, actualízala:

```typescript
// ❌ ANTES
const API_URL = 'https://backend-anterior.vercel.app';

// ✅ AHORA
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
```

## ✅ Paso 2: Verificar Implementación de Google OAuth

### Verifica que estés usando redirección directa (NO fetch/axios)

**✅ CORRECTO:**
```typescript
const handleGoogleLogin = () => {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
  window.location.href = `${API_URL}/api/auth/google`;
};
```

**❌ INCORRECTO:**
```typescript
// Esto NO funciona con OAuth
const handleGoogleLogin = async () => {
  const response = await fetch(`${API_URL}/api/auth/google`);
};
```

### Página de Callback

Asegúrate de tener una ruta `/auth/callback` que maneje el token:

**Ejemplo para Next.js (App Router):**
```typescript
// app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (error) {
      console.error('Error en autenticación:', error);
      router.push('/login?error=auth_failed');
      return;
    }

    if (success === 'true' && token) {
      // Guardar token
      localStorage.setItem('authToken', token);
      
      // Redirigir al dashboard o página principal
      router.push('/dashboard');
    } else {
      router.push('/login?error=no_token');
    }
  }, [searchParams, router]);

  return (
    <div className="loading-container">
      <p>Autenticando...</p>
    </div>
  );
}
```

## ✅ Paso 3: Verificar Endpoints

Todos los endpoints siguen siendo los mismos:

### Autenticación
- `POST /api/usuarios/registrar` - Registro
- `POST /api/usuarios/login` - Login
- `POST /api/usuarios/verificar-otp` - Verificar OTP
- `POST /api/usuarios/reenviar-codigo` - Reenviar código OTP
- `GET /api/auth/google` - Iniciar Google OAuth
- `GET /api/auth/google/callback` - Callback de Google (automático)
- `GET /api/auth/me` - Obtener perfil del usuario autenticado

### Usuarios
- `GET /api/usuarios` - Listar usuarios
- `GET /api/usuarios/:id` - Obtener usuario por ID
- `PUT /api/usuarios/:id` - Actualizar usuario
- `DELETE /api/usuarios/:id` - Eliminar usuario

### Preguntas de Seguridad
- `GET /api/pregunta-seguridad` - Listar preguntas disponibles
- `GET /api/pregunta-seguridad/por-email?email=...` - Obtener pregunta por email
- `POST /api/pregunta-seguridad/verificar` - Verificar respuesta

### Recuperación de Contraseña
- `POST /api/usuarios/pregunta-seguridad` - Obtener pregunta de seguridad
- `POST /api/usuarios/verificar-respuesta` - Verificar respuesta de seguridad
- `POST /api/usuarios/cambiar-password` - Cambiar contraseña

## ✅ Paso 4: Probar Endpoints

Antes de actualizar el código, prueba estos endpoints directamente:

1. **Health Check:**
   ```
   https://miru-franco.onrender.com/salud
   ```
   Debería devolver: `{"status":"ok",...}`

2. **Root:**
   ```
   https://miru-franco.onrender.com/
   ```
   Debería devolver información de la API

3. **Preguntas de Seguridad:**
   ```
   https://miru-franco.onrender.com/api/pregunta-seguridad
   ```
   Debería devolver lista de preguntas

4. **Google OAuth:**
   ```
   https://miru-franco.onrender.com/api/auth/google
   ```
   Debería redirigir a Google

## ✅ Paso 5: Verificar CORS

El backend ya está configurado para aceptar solicitudes desde tu frontend. Si ves errores de CORS:

1. Verifica que `FRONTEND_URL` en Render coincida exactamente con tu URL de frontend
2. Asegúrate de no tener barras finales en las URLs

## ✅ Paso 6: Actualizar Interceptor de API (si usas uno)

Si tienes un interceptor para requests autenticados, verifica que use el token correctamente:

```typescript
// Ejemplo de interceptor
const authenticatedFetch = async (endpoint: string, options: RequestInit = {}) => {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
  const token = localStorage.getItem('authToken');
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Token inválido o expirado
    localStorage.removeItem('authToken');
    window.location.href = '/login';
    throw new Error('No autorizado');
  }

  return response.json();
};
```

## 🔍 Checklist de Actualización

- [ ] Actualizar `NEXT_PUBLIC_API_URL` (o variable equivalente) a `https://miru-franco.onrender.com`
- [ ] Verificar que Google OAuth use `window.location.href` (no fetch/axios)
- [ ] Verificar que existe ruta `/auth/callback` para manejar el token
- [ ] Probar login con Google OAuth
- [ ] Probar registro de nuevo usuario
- [ ] Probar login con email/password
- [ ] Verificar que las preguntas de seguridad se cargan correctamente
- [ ] Verificar que no hay errores de CORS en la consola

## 🐛 Solución de Problemas

### Error: "Failed to fetch"
1. Verifica que `NEXT_PUBLIC_API_URL` esté configurada correctamente
2. Verifica que el backend esté disponible: `https://miru-franco.onrender.com/salud`
3. Revisa la consola del navegador para ver la URL exacta que se está intentando usar

### Error: "Cannot GET /api/auth/google"
1. Verifica que la URL no tenga barra final
2. Asegúrate de usar `window.location.href` y no fetch/axios

### Error: CORS
1. Verifica que `FRONTEND_URL` en Render coincida con tu URL de frontend
2. Verifica que no haya barras finales

### Error 500 en callback de Google
1. Verifica que las tablas de PostgreSQL existan (ver `COMO_CREAR_TABLAS_NEON.md`)
2. Revisa los logs de Render para ver el error exacto

## 📝 Ejemplo Completo: Botón de Google Login

```typescript
// components/GoogleLoginButton.tsx
'use client';

export default function GoogleLoginButton() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
  
  const handleGoogleLogin = () => {
    // ✅ CORRECTO: Redirección directa del navegador
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <button
      onClick={handleGoogleLogin}
      className="google-login-button"
    >
      Continuar con Google
    </button>
  );
}
```

## 📝 Ejemplo Completo: Página de Callback

```typescript
// app/auth/callback/page.tsx (Next.js App Router)
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (error) {
      console.error('Error en autenticación:', error);
      router.push('/login?error=auth_failed');
      return;
    }

    if (success === 'true' && token) {
      // Guardar token
      localStorage.setItem('authToken', token);
      
      // Redirigir al dashboard
      router.push('/dashboard');
    } else {
      router.push('/login?error=no_token');
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-4 text-gray-600">Autenticando...</p>
      </div>
    </div>
  );
}
```

## 🚀 Después de Actualizar

1. **Prueba el flujo completo:**
   - Registro de nuevo usuario
   - Login con email/password
   - Login con Google
   - Recuperación de contraseña

2. **Verifica los logs:**
   - Revisa la consola del navegador
   - Revisa los logs de Render para errores

3. **Si todo funciona:**
   - ✅ Ya puedes eliminar referencias al backend anterior
   - ✅ Ya puedes actualizar la documentación interna

