# 🔄 Guía Frontend: Manejar Expiración de Sesión por Inactividad

## 📋 Resumen del Backend

El backend ahora verifica la inactividad y devuelve:
- **Error 401** con mensaje: `"Sesión expirada por inactividad. Por favor inicia sesión nuevamente."`
- **Timeout**: 15 minutos de inactividad

## 🔧 Implementación en el Frontend

### 1. Interceptor de Axios (Recomendado)

Si usas Axios, crea un interceptor para manejar automáticamente el error 401:

```jsx
// utils/axios.js o api/axios.js
import axios from 'axios';
import { useRouter } from 'next/router'; // Si usas Next.js
// O import { useNavigate } from 'react-router-dom'; // Si usas React Router

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor de respuesta para manejar errores
api.interceptors.response.use(
  (response) => {
    // Si la respuesta es exitosa, retornarla
    return response;
  },
  (error) => {
    // Si hay un error
    if (error.response) {
      const { status, data } = error.response;

      // ✅ Manejar error 401 (Sesión expirada o no autenticado)
      if (status === 401) {
        const message = data?.message || '';
        
        // Verificar si es por inactividad
        if (message.includes('inactividad') || message.includes('Sesión expirada')) {
          // Limpiar token del localStorage
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          
          // Limpiar cualquier otro estado de autenticación
          // (depende de tu implementación: Redux, Context, etc.)
          
          // Redirigir al login
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
            // O usar router si estás en Next.js:
            // router.push('/login');
          }
        } else {
          // Otro tipo de error 401 (credenciales inválidas, etc.)
          // Manejar según tu lógica
        }
      }
    }

    return Promise.reject(error);
  }
);

// Interceptor de request para agregar token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
```

### 2. Hook Personalizado para Manejar Autenticación

```jsx
// hooks/useAuth.js o hooks/useAuth.ts
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/axios';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Verificar si hay token al cargar
    const token = localStorage.getItem('token');
    if (token) {
      // Verificar si el token es válido
      verifyToken();
    } else {
      setLoading(false);
    }
  }, []);

  const verifyToken = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data);
      setLoading(false);
    } catch (error) {
      // Si hay error 401, limpiar y redirigir
      if (error.response?.status === 401) {
        logout();
      }
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await api.post('/usuarios/login', { email, password });
      const { token, usuario } = response.data;
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(usuario));
      setUser(usuario);
      
      router.push('/dashboard');
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.message || 'Error al iniciar sesión' 
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
  };

  return { user, loading, login, logout, verifyToken };
}
```

### 3. Componente de Protección de Rutas

```jsx
// components/ProtectedRoute.jsx
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return <div>Cargando...</div>;
  }

  if (!user) {
    return null; // O un spinner mientras redirige
  }

  return <>{children}</>;
}
```

### 4. Manejo en Componentes Individuales

```jsx
// components/UserProfile.jsx
import { useState, useEffect } from 'react';
import api from '../utils/axios';
import { useRouter } from 'next/router';

export default function UserProfile() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await api.get('/auth/me');
      setProfile(response.data);
    } catch (error) {
      if (error.response?.status === 401) {
        // ✅ Sesión expirada - el interceptor ya maneja la redirección
        // Pero puedes mostrar un mensaje aquí si quieres
        setError('Tu sesión ha expirado. Redirigiendo al login...');
      } else {
        setError('Error al cargar el perfil');
      }
    }
  };

  return (
    <div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {profile && (
        <div>
          <h2>{profile.nombre}</h2>
          <p>{profile.email}</p>
        </div>
      )}
    </div>
  );
}
```

### 5. Manejo Global con Context API

```jsx
// context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/axios';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Verificar token al cargar
    const token = localStorage.getItem('token');
    if (token) {
      verifyAuth();
    } else {
      setLoading(false);
    }

    // Configurar interceptor global
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const message = error.response?.data?.message || '';
          if (message.includes('inactividad') || message.includes('Sesión expirada')) {
            handleSessionExpired();
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.response.eject(interceptor);
    };
  }, []);

  const verifyAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser(response.data);
      setLoading(false);
    } catch (error) {
      if (error.response?.status === 401) {
        handleSessionExpired();
      }
      setLoading(false);
    }
  };

  const handleSessionExpired = () => {
    // Limpiar todo
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    
    // Mostrar mensaje (opcional)
    alert('Tu sesión ha expirado por inactividad. Por favor inicia sesión nuevamente.');
    
    // Redirigir al login
    router.push('/login');
  };

  const login = async (email, password) => {
    try {
      const response = await api.post('/usuarios/login', { email, password });
      const { token, usuario } = response.data;
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(usuario));
      setUser(usuario);
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data?.message || 'Error al iniciar sesión' 
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

### 6. Ejemplo con Fetch (Sin Axios)

```jsx
// utils/api.js
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';

export async function apiRequest(url, options = {}) {
  const token = localStorage.getItem('token');
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  try {
    const response = await fetch(`${API_URL}${url}`, config);
    const data = await response.json();

    // ✅ Manejar error 401 (Sesión expirada)
    if (response.status === 401) {
      const message = data?.message || '';
      
      if (message.includes('inactividad') || message.includes('Sesión expirada')) {
        // Limpiar token
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        
        // Redirigir al login
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
      
      throw new Error(message || 'No autorizado');
    }

    if (!response.ok) {
      throw new Error(data.message || 'Error en la petición');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

// Uso:
// const profile = await apiRequest('/auth/me');
```

## 📝 Checklist de Implementación

### Para el Frontend:

- [ ] **Crear interceptor de Axios** o función wrapper para fetch
- [ ] **Detectar error 401** con mensaje de inactividad
- [ ] **Limpiar token** del localStorage cuando expire
- [ ] **Limpiar estado de usuario** (Context, Redux, etc.)
- [ ] **Redirigir al login** automáticamente
- [ ] **Mostrar mensaje** al usuario (opcional pero recomendado)
- [ ] **Probar** esperando 16 minutos y haciendo una petición

## 🧪 Cómo Probar

### Prueba 1: Verificar que funciona

1. **Hacer login** en tu frontend
2. **Esperar 16 minutos** sin hacer ninguna petición
3. **Hacer cualquier petición autenticada** (ej: cargar perfil, hacer una acción)
4. **Resultado esperado:**
   - Error 401 recibido
   - Token eliminado del localStorage
   - Redirección automática a `/login`
   - Mensaje mostrado (si lo implementaste)

### Prueba 2: Verificar que NO se cierra si hay actividad

1. **Hacer login**
2. **Hacer peticiones cada 5 minutos** (mantener actividad)
3. **Después de 20 minutos** (pero con actividad constante)
4. **Resultado esperado:**
   - Sesión sigue activa
   - No hay redirección

## 💡 Mejoras Opcionales (UX)

### 1. Mostrar Advertencia Antes de Expirar

```jsx
// hooks/useSessionTimeout.js
import { useEffect, useState } from 'react';

export function useSessionTimeout(timeoutMinutes = 15, warningMinutes = 2) {
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    let interval;

    const checkActivity = () => {
      const lastActivity = localStorage.getItem('lastActivity');
      if (lastActivity) {
        const now = Date.now();
        const elapsed = (now - parseInt(lastActivity)) / 1000 / 60; // minutos
        const remaining = timeoutMinutes - elapsed;

        if (remaining <= 0) {
          // Ya expiró
          setTimeRemaining(0);
        } else if (remaining <= warningMinutes) {
          // Mostrar advertencia
          setShowWarning(true);
          setTimeRemaining(Math.ceil(remaining));
        } else {
          setShowWarning(false);
          setTimeRemaining(null);
        }
      }
    };

    // Verificar cada minuto
    interval = setInterval(checkActivity, 60000);
    checkActivity(); // Verificar inmediatamente

    // Actualizar lastActivity en cada interacción
    const updateActivity = () => {
      localStorage.setItem('lastActivity', Date.now().toString());
      checkActivity();
    };

    window.addEventListener('click', updateActivity);
    window.addEventListener('keypress', updateActivity);
    window.addEventListener('scroll', updateActivity);

    return () => {
      clearInterval(interval);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('keypress', updateActivity);
      window.removeEventListener('scroll', updateActivity);
    };
  }, [timeoutMinutes, warningMinutes]);

  return { timeRemaining, showWarning };
}

// Uso en componente:
function Dashboard() {
  const { timeRemaining, showWarning } = useSessionTimeout(15, 2);

  return (
    <div>
      {showWarning && (
        <div style={{ 
          background: 'yellow', 
          padding: '10px',
          position: 'fixed',
          top: 0,
          width: '100%',
          zIndex: 9999
        }}>
          ⚠️ Tu sesión expirará en {timeRemaining} minutos. 
          <button onClick={() => window.location.reload()}>
            Mantener sesión activa
          </button>
        </div>
      )}
      {/* Resto del componente */}
    </div>
  );
}
```

### 2. Limpiar Estado de Redux/Context

```jsx
// Si usas Redux
import { useDispatch } from 'react-redux';
import { logout } from '../store/slices/authSlice';

// En el interceptor:
if (error.response?.status === 401 && message.includes('inactividad')) {
  dispatch(logout()); // Limpiar estado de Redux
  localStorage.removeItem('token');
  router.push('/login');
}
```

## 📊 Respuestas del Backend

### Error 401 - Sesión Expirada por Inactividad:

```json
{
  "statusCode": 401,
  "message": "Sesión expirada por inactividad. Por favor inicia sesión nuevamente.",
  "error": "Unauthorized"
}
```

### Error 401 - Token Revocado:

```json
{
  "statusCode": 401,
  "message": "Token revocado. Por favor inicia sesión nuevamente.",
  "error": "Unauthorized"
}
```

### Error 401 - Credenciales Inválidas:

```json
{
  "statusCode": 401,
  "message": "Credenciales inválidas",
  "error": "Unauthorized"
}
```

## ✅ Resumen de Implementación

1. **Interceptor/Función wrapper** - Captura todos los errores 401
2. **Detectar mensaje de inactividad** - Verificar si el mensaje incluye "inactividad"
3. **Limpiar almacenamiento** - Eliminar token y datos de usuario
4. **Redirigir** - Enviar al usuario a `/login`
5. **Mostrar mensaje** - Informar al usuario (opcional)

## 🔍 Debugging

Si no funciona, verifica:

1. **¿El interceptor está configurado?**
   ```jsx
   console.log('Interceptor configurado');
   ```

2. **¿Se está recibiendo el error 401?**
   ```jsx
   console.log('Error recibido:', error.response);
   ```

3. **¿El mensaje incluye "inactividad"?**
   ```jsx
   console.log('Mensaje:', error.response?.data?.message);
   ```

4. **¿Se está limpiando el token?**
   ```jsx
   console.log('Token antes:', localStorage.getItem('token'));
   localStorage.removeItem('token');
   console.log('Token después:', localStorage.getItem('token'));
   ```

¡Con estos cambios, tu frontend manejará correctamente la expiración de sesión por inactividad!

