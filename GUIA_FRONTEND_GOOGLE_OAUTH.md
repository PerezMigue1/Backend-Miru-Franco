# 🔐 Guía: Implementar Google OAuth en Frontend

## 📋 Resumen del Flujo

```
1. Usuario hace clic en "Continuar con Google"
2. Frontend redirige a: https://miru-franco.onrender.com/api/auth/google
3. Backend redirige a Google para autenticación
4. Usuario autoriza en Google
5. Google redirige a: https://miru-franco.onrender.com/api/auth/google/callback
6. Backend redirige a: https://tu-frontend.com/auth/callback?token=xxx&success=true
7. Frontend guarda token y autentica al usuario
```

---

## ✅ Paso 1: Configurar Variables de Entorno

En tu frontend (archivo `.env` o `.env.local`):

```env
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com
# o si usas otro framework:
VITE_API_URL=https://miru-franco.onrender.com
```

---

## ✅ Paso 2: Crear Componente/Botón de Google Login

### Opción A: Si usas Next.js (App Router)

**Archivo: `app/login/page.tsx` o `pages/login.tsx`**

```typescript
'use client'; // Si usas App Router

export default function LoginPage() {
  const handleGoogleLogin = () => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
    
    // ✅ CORRECTO: Redirección directa del navegador
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <div>
      <h1>Iniciar Sesión</h1>
      <button 
        onClick={handleGoogleLogin}
        className="google-login-button"
      >
        <svg>...</svg>
        Continuar con Google
      </button>
    </div>
  );
}
```

### Opción B: Si usas Next.js (Pages Router)

**Archivo: `pages/login.tsx`**

```typescript
import { useRouter } from 'next/router';

export default function LoginPage() {
  const router = useRouter();
  
  const handleGoogleLogin = () => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
    
    // ✅ CORRECTO: Redirección directa del navegador
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <div>
      <h1>Iniciar Sesión</h1>
      <button onClick={handleGoogleLogin}>
        Continuar con Google
      </button>
    </div>
  );
}
```

### Opción C: Si usas React (Vite/CRA)

**Archivo: `src/components/GoogleLoginButton.tsx`**

```typescript
const API_URL = import.meta.env.VITE_API_URL || 'https://miru-franco.onrender.com';

export default function GoogleLoginButton() {
  const handleGoogleLogin = () => {
    // ✅ CORRECTO: Redirección directa del navegador
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <button onClick={handleGoogleLogin}>
      Continuar con Google
    </button>
  );
}
```

### Opción D: Si usas HTML/JavaScript puro

**Archivo: `login.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Login</title>
</head>
<body>
  <h1>Iniciar Sesión</h1>
  <button onclick="handleGoogleLogin()">
    Continuar con Google
  </button>

  <script>
    const API_URL = 'https://miru-franco.onrender.com';
    
    function handleGoogleLogin() {
      // ✅ CORRECTO: Redirección directa del navegador
      window.location.href = `${API_URL}/api/auth/google`;
    }
  </script>
</body>
</html>
```

---

## ✅ Paso 3: Crear Página de Callback

### Next.js (App Router)

**Archivo: `app/auth/callback/page.tsx`**

```typescript
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
      // Manejar error
      console.error('Error en autenticación:', error);
      router.push('/login?error=auth_failed');
      return;
    }

    if (success === 'true' && token) {
      // ✅ Guardar token en localStorage
      localStorage.setItem('authToken', token);
      
      // ✅ O guardar en estado global (Redux, Context, etc.)
      // dispatch(setAuthToken(token));
      
      // Redirigir al dashboard o página principal
      router.push('/dashboard');
    } else {
      // Si no hay token, redirigir al login
      router.push('/login?error=no_token');
    }
  }, [searchParams, router]);

  return (
    <div className="loading-container">
      <p>Autenticando...</p>
      {/* Spinner opcional */}
    </div>
  );
}
```

### Next.js (Pages Router)

**Archivo: `pages/auth/callback.tsx`**

```typescript
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function AuthCallback() {
  const router = useRouter();
  const { token, success, error } = router.query;

  useEffect(() => {
    if (error) {
      console.error('Error en autenticación:', error);
      router.push('/login?error=auth_failed');
      return;
    }

    if (success === 'true' && token) {
      // ✅ Guardar token
      localStorage.setItem('authToken', token as string);
      
      // Redirigir
      router.push('/dashboard');
    } else {
      router.push('/login?error=no_token');
    }
  }, [token, success, error, router]);

  return <div>Autenticando...</div>;
}
```

### React (Vite/CRA)

**Archivo: `src/pages/AuthCallback.tsx`**

```typescript
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (error) {
      console.error('Error:', error);
      navigate('/login?error=auth_failed');
      return;
    }

    if (success === 'true' && token) {
      localStorage.setItem('authToken', token);
      navigate('/dashboard');
    } else {
      navigate('/login?error=no_token');
    }
  }, [searchParams, navigate]);

  return <div>Autenticando...</div>;
}
```

### HTML/JavaScript puro

**Archivo: `auth/callback.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Autenticando...</title>
</head>
<body>
  <div>Autenticando...</div>
  
  <script>
    // Obtener parámetros de la URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const success = urlParams.get('success');
    const error = urlParams.get('error');

    if (error) {
      console.error('Error:', error);
      window.location.href = '/login?error=auth_failed';
    } else if (success === 'true' && token) {
      // Guardar token
      localStorage.setItem('authToken', token);
      // Redirigir
      window.location.href = '/dashboard';
    } else {
      window.location.href = '/login?error=no_token';
    }
  </script>
</body>
</html>
```

---

## ✅ Paso 4: Configurar Rutas (si usas React Router)

**Archivo: `src/App.tsx` o `src/routes.tsx`**

```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AuthCallback from './pages/AuthCallback';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {/* otras rutas */}
      </Routes>
    </BrowserRouter>
  );
}
```

---

## ✅ Paso 5: Crear Interceptor para Requests Autenticados

**Archivo: `src/utils/api.ts` o `src/services/api.ts`**

```typescript
const API_URL = import.meta.env.VITE_API_URL || 'https://miru-franco.onrender.com';

// Función para hacer requests autenticados
export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {}
) {
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
}

// Ejemplo de uso:
export async function getUserProfile() {
  return authenticatedFetch('/api/auth/me');
}
```

---

## ❌ Errores Comunes a Evitar

### ❌ NO hagas esto:

```typescript
// ❌ INCORRECTO - No funciona con OAuth
const handleGoogleLogin = async () => {
  const response = await fetch(`${API_URL}/api/auth/google`);
  const data = await response.json();
};

// ❌ INCORRECTO - No puedes usar axios/fetch para OAuth
import axios from 'axios';
const response = await axios.get(`${API_URL}/api/auth/google`);

// ❌ INCORRECTO - No funciona en una nueva pestaña
window.open(`${API_URL}/api/auth/google`, '_blank');
```

### ✅ Haz esto:

```typescript
// ✅ CORRECTO - Redirección directa
const handleGoogleLogin = () => {
  window.location.href = `${API_URL}/api/auth/google`;
};
```

---

## 🔍 Verificación Final

1. ✅ **Botón de Google Login**: Redirige a `${API_URL}/api/auth/google`
2. ✅ **Página de Callback**: Existe en `/auth/callback`
3. ✅ **Manejo de Token**: Guarda el token en localStorage o estado
4. ✅ **Redirect después de login**: Lleva al usuario al dashboard
5. ✅ **Manejo de errores**: Maneja casos de error

---

## 📝 Ejemplo Completo (Next.js App Router)

```typescript
// app/login/page.tsx
'use client';

export default function LoginPage() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';
  
  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-2xl font-bold text-center">Iniciar Sesión</h1>
        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg px-6 py-3 hover:bg-gray-50 transition"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            {/* Icono de Google */}
          </svg>
          Continuar con Google
        </button>
      </div>
    </div>
  );
}
```

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

    if (success === 'true' && token) {
      localStorage.setItem('authToken', token);
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

---

## 🚀 Listo!

Con estos pasos, tu frontend debería funcionar correctamente con Google OAuth. El flujo será:

1. Usuario hace clic → Redirige a Google
2. Usuario autoriza → Google redirige al backend
3. Backend procesa → Redirige al frontend con token
4. Frontend guarda token → Usuario autenticado ✅

