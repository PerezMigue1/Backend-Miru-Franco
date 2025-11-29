# 🔐 Guía de Actualización del Frontend - Nuevas Medidas de Seguridad

## 📋 Resumen de Cambios en el Backend

El backend ahora incluye las siguientes nuevas funcionalidades de seguridad:

1. ✅ **Revocación de sesiones** - Logout que invalida tokens
2. ✅ **Sesiones expiradas por inactividad** - Tokens expiran después de 15 min sin actividad
3. ✅ **Renovación de tokens** - Endpoint para refrescar tokens automáticamente
4. ✅ **Validación de respuestas comunes** - Rechaza respuestas débiles en preguntas de seguridad
5. ✅ **RBAC básico** - Sistema de roles (usuario/admin)
6. ✅ **CSRF Protection** - Protección contra ataques CSRF

---

## 1. 🔄 Logout con Revocación de Sesiones

### Antes
```typescript
// Logout simple - solo eliminar token del localStorage
const logout = () => {
  localStorage.removeItem('authToken');
  router.push('/login');
};
```

### Después (Nuevo)
```typescript
// Logout que revoca el token en el servidor
const logout = async () => {
  const token = localStorage.getItem('authToken');
  
  if (token) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  }
  
  // Limpiar token local independientemente del resultado
  localStorage.removeItem('authToken');
  router.push('/login');
};
```

### Endpoint
```
POST /api/auth/logout
Headers: Authorization: Bearer <token>
Response: { "success": true, "message": "Sesión cerrada correctamente" }
```

---

## 2. ⏱️ Manejo de Sesiones Expiradas por Inactividad

### Problema
Los tokens ahora expiran después de 15 minutos de inactividad. Si el usuario no hace ninguna petición al backend, la sesión se cierra automáticamente.

### Solución: Renovación Automática de Tokens

```typescript
// Interceptor para renovar token automáticamente
import axios from 'axios';

const apiClient = axios.create({
  baseURL: API_URL,
});

// Interceptor para agregar token y renovar si es necesario
apiClient.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      
      // Renovar token antes de cada petición si ha pasado tiempo
      const tokenData = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      const timeSinceActivity = now - (tokenData.lastActivity || tokenData.iat);
      
      // Si han pasado más de 10 minutos, renovar token
      if (timeSinceActivity > 10 * 60) {
        try {
          const response = await fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const data = await response.json();
            localStorage.setItem('authToken', data.token);
            config.headers.Authorization = `Bearer ${data.token}`;
          }
        } catch (error) {
          // Si falla la renovación, redirigir al login
          localStorage.removeItem('authToken');
          window.location.href = '/login';
        }
      }
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor de respuesta para manejar errores de sesión expirada
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const message = error.response?.data?.message || '';
      
      // Si es por inactividad, redirigir al login
      if (message.includes('inactividad') || message.includes('expirada')) {
        localStorage.removeItem('authToken');
        window.location.href = '/login?session_expired=true';
      }
    }
    
    return Promise.reject(error);
  }
);
```

### Endpoint de Renovación
```
POST /api/auth/refresh
Headers: Authorization: Bearer <token_actual>
Response: { "success": true, "token": "<nuevo_token>" }
```

---

## 3. 🔄 Componente con Renovación Automática

### Ejemplo Completo: Hook de React

```typescript
import { useEffect, useRef } from 'react';

export function useAutoRefreshToken() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) return;

    // Función para renovar token
    const refreshToken = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          localStorage.setItem('authToken', data.token);
        } else {
          // Token inválido, limpiar y redirigir
          localStorage.removeItem('authToken');
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('Error renovando token:', error);
      }
    };

    // Renovar cada 10 minutos
    intervalRef.current = setInterval(refreshToken, 10 * 60 * 1000);

    // Limpiar al desmontar
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);
}
```

**Usar en tu componente principal**:
```typescript
function App() {
  useAutoRefreshToken();
  // ... resto de tu código
}
```

---

## 4. ✅ Validación de Respuestas de Pregunta Secreta

### Cambio
El backend ahora rechaza respuestas muy comunes o débiles.

### Manejo en el Frontend

```typescript
const handleRecuperarPassword = async (email: string, pregunta: string, respuesta: string) => {
  try {
    const response = await fetch(`${API_URL}/api/usuarios/verificar-respuesta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, respuesta }),
    });

    const data = await response.json();

    if (response.ok) {
      // Respuesta correcta
      return { success: true, token: data.token };
    } else {
      // Manejar error
      if (data.message?.includes('común') || data.message?.includes('débil')) {
        return { 
          success: false, 
          error: 'La respuesta es demasiado común. Por favor elige una respuesta más personal y segura.' 
        };
      }
      return { success: false, error: data.message || 'Respuesta incorrecta' };
    }
  } catch (error) {
    return { success: false, error: 'Error al verificar la respuesta' };
  }
};
```

**Respuestas que serán rechazadas**:
- "123", "1234", "password", "admin", "test"
- Respuestas de menos de 3 caracteres
- Respuestas muy comunes

---

## 5. 👥 Sistema de Roles (RBAC)

### Nuevo Campo en Usuario

Los usuarios ahora tienen un campo `rol`:
- `"usuario"` - Rol por defecto
- `"admin"` - Rol de administrador

### Verificar Rol en Frontend

```typescript
// Obtener perfil del usuario
const getProfile = async () => {
  const token = localStorage.getItem('authToken');
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const data = await response.json();
  return data.data; // { id, nombre, email, rol, ... }
};

// Verificar si es admin
const isAdmin = async () => {
  const profile = await getProfile();
  return profile?.rol === 'admin';
};

// Componente que solo muestra contenido para admin
function AdminPanel() {
  const [isUserAdmin, setIsUserAdmin] = useState(false);

  useEffect(() => {
    isAdmin().then(setIsUserAdmin);
  }, []);

  if (!isUserAdmin) {
    return <div>No tienes permisos para acceder a esta sección</div>;
  }

  return <div>Panel de Administración</div>;
}
```

### Endpoints Protegidos por Rol

Algunos endpoints ahora requieren rol `admin`. Si intentas acceder sin permisos, recibirás:

```json
{
  "statusCode": 403,
  "message": "No tienes permisos para acceder a este recurso"
}
```

**Manejo en Frontend**:
```typescript
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      // Usuario sin permisos
      alert('No tienes permisos para realizar esta acción');
    }
    return Promise.reject(error);
  }
);
```

---

## 6. 🛡️ Protección CSRF

### Cambio
Las peticiones POST/PUT/DELETE ahora requieren un token CSRF.

### Implementación en Frontend

**Opción 1: Usar Cookies (Recomendado si tu backend soporta cookies)**

Si el backend configura cookies automáticamente:
```typescript
// Las cookies se envían automáticamente
fetch(`${API_URL}/api/usuarios/login`, {
  method: 'POST',
  credentials: 'include', // Importante para enviar cookies
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email, password }),
});
```

**Opción 2: Obtener Token CSRF y Enviarlo en Header**

```typescript
// Obtener token CSRF (si el backend lo expone en un endpoint)
const getCsrfToken = async () => {
  const response = await fetch(`${API_URL}/api/csrf-token`, {
    credentials: 'include',
  });
  return response.headers.get('X-CSRF-Token');
};

// Usar en peticiones
const login = async (email: string, password: string) => {
  const csrfToken = await getCsrfToken();
  
  const response = await fetch(`${API_URL}/api/usuarios/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken || '',
    },
    body: JSON.stringify({ email, password }),
  });
  
  return response.json();
};
```

**Nota**: Si usas React/Next.js con formularios del servidor, el CSRF puede manejarse automáticamente.

---

## 7. 🔄 Manejo Mejorado de Errores

### Errores de Sesión Expirada

```typescript
// Interceptor global para manejar errores de sesión
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const message = error.response?.data?.message || '';
      
      if (message.includes('inactividad') || message.includes('expirada')) {
        // Sesión expirada por inactividad
        localStorage.removeItem('authToken');
        window.location.href = '/login?reason=inactivity';
      } else if (message.includes('revocado')) {
        // Token revocado (logout desde otro dispositivo)
        localStorage.removeItem('authToken');
        window.location.href = '/login?reason=revoked';
      } else {
        // Otro error 401 (credenciales inválidas)
        // Manejar según el contexto
      }
    }
    
    if (error.response?.status === 403) {
      // Sin permisos
      alert('No tienes permisos para realizar esta acción');
    }
    
    return Promise.reject(error);
  }
);
```

---

## 8. 📱 Componente de Login Mejorado

```typescript
function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Verificar si viene de sesión expirada
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');
    
    if (reason === 'inactivity') {
      setError('Tu sesión expiró por inactividad. Por favor inicia sesión nuevamente.');
    } else if (reason === 'revoked') {
      setError('Tu sesión fue cerrada desde otro dispositivo. Por favor inicia sesión nuevamente.');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/usuarios/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('authToken', data.token);
        window.location.href = '/dashboard';
      } else {
        if (data.message?.includes('bloqueada')) {
          setError('Tu cuenta está bloqueada temporalmente por múltiples intentos fallidos.');
        } else {
          setError(data.message || 'Credenciales inválidas');
        }
      }
    } catch (error) {
      setError('Error al iniciar sesión. Intenta nuevamente.');
    }
  };

  return (
    <form onSubmit={handleLogin}>
      {error && <div className="error">{error}</div>}
      <input 
        type="email" 
        value={email} 
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input 
        type="password" 
        value={password} 
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña"
      />
      <button type="submit">Iniciar Sesión</button>
    </form>
  );
}
```

---

## 9. ✅ Checklist de Actualización

- [ ] Actualizar función de logout para llamar a `/api/auth/logout`
- [ ] Implementar renovación automática de tokens
- [ ] Agregar interceptor para manejar sesiones expiradas
- [ ] Actualizar mensajes de error para respuestas comunes
- [ ] Implementar verificación de roles (si hay contenido admin)
- [ ] Configurar CSRF tokens (si se requiere)
- [ ] Actualizar manejo de errores 401/403
- [ ] Probar logout desde múltiples dispositivos
- [ ] Probar expiración por inactividad
- [ ] Verificar que tokens se renueven automáticamente

---

## 10. 🔗 Nuevos Endpoints Disponibles

### Logout
```
POST /api/auth/logout
Headers: Authorization: Bearer <token>
```

### Renovar Token
```
POST /api/auth/refresh
Headers: Authorization: Bearer <token>
Response: { "success": true, "token": "<nuevo_token>" }
```

### Obtener Perfil (incluye rol)
```
GET /api/auth/me
Headers: Authorization: Bearer <token>
Response: { "success": true, "data": { ..., "rol": "usuario" } }
```

---

## 📚 Ejemplo Completo: Cliente API Configurado

```typescript
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';

const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Para cookies CSRF
});

// Interceptor de request: agregar token y renovar si es necesario
apiClient.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem('authToken');
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      
      // Renovar token si es necesario
      try {
        const tokenData = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);
        const timeSinceActivity = now - (tokenData.lastActivity || tokenData.iat);
        
        if (timeSinceActivity > 10 * 60) { // 10 minutos
          const refreshResponse = await axios.post(
            `${API_URL}/api/auth/refresh`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
          );
          
          if (refreshResponse.data.token) {
            localStorage.setItem('authToken', refreshResponse.data.token);
            config.headers.Authorization = `Bearer ${refreshResponse.data.token}`;
          }
        }
      } catch (error) {
        // Ignorar errores de renovación silenciosamente
      }
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor de response: manejar errores
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const message = error.response?.data?.message || '';
      
      if (message.includes('inactividad') || message.includes('expirada')) {
        localStorage.removeItem('authToken');
        window.location.href = '/login?reason=inactivity';
      } else if (message.includes('revocado')) {
        localStorage.removeItem('authToken');
        window.location.href = '/login?reason=revoked';
      }
    }
    
    if (error.response?.status === 403) {
      // Mostrar mensaje de permisos
      alert('No tienes permisos para realizar esta acción');
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
```

---

## 🎯 Resumen de Cambios Principales

1. **Logout** debe llamar al endpoint `/api/auth/logout`
2. **Tokens** se renuevan automáticamente cada 10 minutos
3. **Sesiones** expiran después de 15 minutos de inactividad
4. **Respuestas comunes** son rechazadas en preguntas de seguridad
5. **Roles** están disponibles en el perfil del usuario
6. **CSRF** puede requerir configuración adicional (dependiendo de la implementación)

¡Implementa estos cambios y tu frontend estará completamente actualizado con las nuevas medidas de seguridad!

