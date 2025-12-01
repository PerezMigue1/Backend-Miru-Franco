# 🔐 Guía Frontend: Implementar Logout Global

## 📋 Resumen

Esta guía te ayudará a implementar el **logout global** en tu frontend, permitiendo que los usuarios cierren todas sus sesiones desde cualquier dispositivo.

## 🎯 Funcionalidad

- **Logout Individual**: Cierra solo la sesión del dispositivo actual
- **Logout Global**: Cierra todas las sesiones del usuario en todos los dispositivos

## 🔌 Endpoints Disponibles

### 1. Logout Individual (Solo este dispositivo)
```http
POST /api/auth/logout
Authorization: Bearer <token>
Content-Type: application/json

{
  "logoutAll": false  // Opcional, default: false
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Sesión cerrada correctamente"
}
```

### 2. Logout Global (Todos los dispositivos)
```http
POST /api/auth/logout-all
Authorization: Bearer <token>
```

**O usando el endpoint de logout con parámetro:**
```http
POST /api/auth/logout
Authorization: Bearer <token>
Content-Type: application/json

{
  "logoutAll": true
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Todas las sesiones han sido cerradas correctamente"
}
```

## 🔧 Implementación

### Opción 1: Con Axios (Recomendado)

#### 1. Crear funciones de logout

```jsx
// utils/auth.js o services/auth.js
import api from './axios'; // Tu instancia de axios configurada

/**
 * Cierra sesión solo en este dispositivo
 */
export const logout = async () => {
  try {
    const response = await api.post('/auth/logout', { 
      logoutAll: false 
    });
    
    // Limpiar token del localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    return {
      success: true,
      message: response.data.message || 'Sesión cerrada correctamente'
    };
  } catch (error) {
    // Incluso si hay error, limpiar el token localmente
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    return {
      success: false,
      error: error.response?.data?.message || 'Error al cerrar sesión'
    };
  }
};

/**
 * Cierra todas las sesiones del usuario en todos los dispositivos
 */
export const logoutAll = async () => {
  try {
    const response = await api.post('/auth/logout-all');
    
    // Limpiar token del localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    return {
      success: true,
      message: response.data.message || 'Todas las sesiones han sido cerradas'
    };
  } catch (error) {
    // Incluso si hay error, limpiar el token localmente
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    return {
      success: false,
      error: error.response?.data?.message || 'Error al cerrar todas las sesiones'
    };
  }
};
```

#### 2. Usar en componentes

```jsx
// components/UserMenu.jsx o components/Header.jsx
import { useState } from 'react';
import { useRouter } from 'next/router'; // Si usas Next.js
// O import { useNavigate } from 'react-router-dom'; // Si usas React Router
import { logout, logoutAll } from '../utils/auth';

export default function UserMenu() {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter(); // O useNavigate() para React Router

  const handleLogout = async () => {
    setLoading(true);
    try {
      const result = await logout();
      if (result.success) {
        // Redirigir al login
        router.push('/login');
        // O navigate('/login') para React Router
      } else {
        // Mostrar error
        alert(result.error);
      }
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
      alert('Error al cerrar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutAll = async () => {
    setLoading(true);
    try {
      const result = await logoutAll();
      if (result.success) {
        // Mostrar mensaje de confirmación
        alert('Todas tus sesiones han sido cerradas');
        // Redirigir al login
        router.push('/login');
      } else {
        alert(result.error);
      }
    } catch (error) {
      console.error('Error al cerrar todas las sesiones:', error);
      alert('Error al cerrar todas las sesiones');
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="user-menu">
      <button 
        onClick={handleLogout} 
        disabled={loading}
        className="logout-btn"
      >
        {loading ? 'Cerrando...' : 'Cerrar sesión'}
      </button>
      
      <button 
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        className="logout-all-btn"
        style={{ color: 'red', marginLeft: '10px' }}
      >
        Cerrar todas las sesiones
      </button>

      {showConfirm && (
        <div className="confirm-dialog">
          <p>¿Estás seguro de que quieres cerrar todas tus sesiones?</p>
          <p style={{ fontSize: '0.9em', color: '#666' }}>
            Esto cerrará tu sesión en todos los dispositivos (laptop, teléfono, etc.)
          </p>
          <div>
            <button onClick={handleLogoutAll} disabled={loading}>
              Sí, cerrar todas
            </button>
            <button onClick={() => setShowConfirm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Opción 2: Con Hook Personalizado

```jsx
// hooks/useAuth.js
import { useState } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/axios';

export function useAuth() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const logout = async (logoutAll = false) => {
    setLoading(true);
    try {
      if (logoutAll) {
        await api.post('/auth/logout-all');
      } else {
        await api.post('/auth/logout', { logoutAll: false });
      }
      
      // Limpiar almacenamiento
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      
      // Limpiar estado (si usas Context/Redux)
      // dispatch(logout()); // Ejemplo con Redux
      
      // Redirigir al login
      router.push('/login');
      
      return { success: true };
    } catch (error) {
      // Incluso si hay error, limpiar localmente
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      router.push('/login');
      
      return { 
        success: false, 
        error: error.response?.data?.message || 'Error al cerrar sesión' 
      };
    } finally {
      setLoading(false);
    }
  };

  return { logout, loading };
}

// Uso en componente:
function UserMenu() {
  const { logout, loading } = useAuth();

  return (
    <div>
      <button onClick={() => logout(false)} disabled={loading}>
        Cerrar sesión
      </button>
      <button onClick={() => logout(true)} disabled={loading}>
        Cerrar todas las sesiones
      </button>
    </div>
  );
}
```

### Opción 3: Con Context API

```jsx
// context/AuthContext.jsx
import { createContext, useContext, useState } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/axios';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const logout = async (logoutAll = false) => {
    setLoading(true);
    try {
      if (logoutAll) {
        await api.post('/auth/logout-all');
      } else {
        await api.post('/auth/logout', { logoutAll: false });
      }
      
      // Limpiar todo
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      
      // Redirigir
      router.push('/login');
      
      return { success: true };
    } catch (error) {
      // Limpiar incluso si hay error
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
      router.push('/login');
      
      return { 
        success: false, 
        error: error.response?.data?.message || 'Error al cerrar sesión' 
      };
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Uso:
function UserMenu() {
  const { logout, loading } = useAuth();

  return (
    <div>
      <button onClick={() => logout(false)} disabled={loading}>
        Cerrar sesión
      </button>
      <button onClick={() => logout(true)} disabled={loading}>
        Cerrar todas las sesiones
      </button>
    </div>
  );
}
```

### Opción 4: Con Fetch (Sin Axios)

```jsx
// utils/auth.js
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api';

export const logout = async (logoutAll = false) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    // Ya no hay token, limpiar y redirigir
    localStorage.removeItem('user');
    window.location.href = '/login';
    return { success: true };
  }

  try {
    const url = logoutAll 
      ? `${API_URL}/auth/logout-all`
      : `${API_URL}/auth/logout`;
    
    const body = logoutAll ? undefined : JSON.stringify({ logoutAll: false });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body,
    });

    const data = await response.json();

    // Limpiar almacenamiento
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    if (response.ok) {
      return { success: true, message: data.message };
    } else {
      return { success: false, error: data.message || 'Error al cerrar sesión' };
    }
  } catch (error) {
    // Limpiar incluso si hay error
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    return { 
      success: false, 
      error: 'Error de conexión al cerrar sesión' 
    };
  }
};
```

## 🎨 Ejemplos de UI/UX

### Ejemplo 1: Menú Desplegable

```jsx
// components/UserDropdown.jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { logout, logoutAll } from '../utils/auth';

export default function UserDropdown({ user }) {
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setLoading(true);
    const result = await logout();
    if (result.success) {
      router.push('/login');
    }
    setLoading(false);
  };

  const handleLogoutAll = async () => {
    setLoading(true);
    const result = await logoutAll();
    if (result.success) {
      alert('Todas tus sesiones han sido cerradas');
      router.push('/login');
    }
    setLoading(false);
    setShowConfirm(false);
  };

  return (
    <div className="user-dropdown">
      <button onClick={() => setShowMenu(!showMenu)}>
        {user.nombre} ▼
      </button>
      
      {showMenu && (
        <div className="dropdown-menu">
          <div className="user-info">
            <p>{user.email}</p>
          </div>
          
          <hr />
          
          <button onClick={handleLogout} disabled={loading}>
            Cerrar sesión
          </button>
          
          <button 
            onClick={() => {
              setShowConfirm(true);
              setShowMenu(false);
            }}
            disabled={loading}
            className="danger"
          >
            Cerrar todas las sesiones
          </button>
        </div>
      )}

      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Cerrar todas las sesiones?</h3>
            <p>
              Esto cerrará tu sesión en todos los dispositivos donde hayas iniciado sesión
              (laptop, teléfono, tablet, etc.)
            </p>
            <div className="modal-actions">
              <button 
                onClick={handleLogoutAll} 
                disabled={loading}
                className="danger"
              >
                {loading ? 'Cerrando...' : 'Sí, cerrar todas'}
              </button>
              <button 
                onClick={() => setShowConfirm(false)}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Ejemplo 2: Página de Configuración

```jsx
// pages/settings.jsx o components/Settings.jsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { logout, logoutAll } from '../utils/auth';

export default function Settings() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setLoading(true);
    await logout();
    router.push('/login');
    setLoading(false);
  };

  const handleLogoutAll = async () => {
    if (!confirm('¿Estás seguro de que quieres cerrar todas tus sesiones?')) {
      return;
    }
    
    setLoading(true);
    const result = await logoutAll();
    if (result.success) {
      alert('Todas tus sesiones han sido cerradas');
      router.push('/login');
    }
    setLoading(false);
  };

  return (
    <div className="settings-page">
      <h2>Configuración de Sesión</h2>
      
      <div className="session-section">
        <h3>Sesión Actual</h3>
        <p>Gestiona tu sesión en este dispositivo</p>
        <button 
          onClick={handleLogout} 
          disabled={loading}
          className="btn-primary"
        >
          Cerrar sesión
        </button>
      </div>

      <div className="session-section danger-zone">
        <h3>Zona de Peligro</h3>
        <p>
          Cerrar todas las sesiones cerrará tu sesión en todos los dispositivos
          donde hayas iniciado sesión (laptop, teléfono, tablet, etc.)
        </p>
        <button 
          onClick={handleLogoutAll} 
          disabled={loading}
          className="btn-danger"
        >
          {loading ? 'Cerrando...' : 'Cerrar todas las sesiones'}
        </button>
      </div>
    </div>
  );
}
```

### Ejemplo 3: Con Toast Notifications

```jsx
// components/UserMenu.jsx
import { toast } from 'react-toastify'; // O tu librería de toast favorita
import { logout, logoutAll } from '../utils/auth';

export default function UserMenu() {
  const handleLogout = async () => {
    const result = await logout();
    if (result.success) {
      toast.success('Sesión cerrada correctamente');
      router.push('/login');
    } else {
      toast.error(result.error);
    }
  };

  const handleLogoutAll = async () => {
    if (!confirm('¿Cerrar todas las sesiones?')) return;
    
    const result = await logoutAll();
    if (result.success) {
      toast.success('Todas tus sesiones han sido cerradas');
      router.push('/login');
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div>
      <button onClick={handleLogout}>Cerrar sesión</button>
      <button onClick={handleLogoutAll}>Cerrar todas las sesiones</button>
    </div>
  );
}
```

## 📱 Manejo de Errores

### Manejar Error 401 (Token ya revocado)

```jsx
// En tu interceptor de Axios
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const message = error.response?.data?.message || '';
      
      // Si es por logout global o token revocado
      if (message.includes('Sesión cerrada') || message.includes('Token revocado')) {
        // Limpiar y redirigir
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    
    return Promise.reject(error);
  }
);
```

## ✅ Checklist de Implementación

- [ ] Crear función `logout()` para logout individual
- [ ] Crear función `logoutAll()` para logout global
- [ ] Agregar botón "Cerrar sesión" en el menú de usuario
- [ ] Agregar botón "Cerrar todas las sesiones" con confirmación
- [ ] Limpiar `localStorage` después de logout
- [ ] Redirigir a `/login` después de logout exitoso
- [ ] Manejar errores (limpiar localmente incluso si falla la petición)
- [ ] Mostrar mensajes de confirmación para logout global
- [ ] Probar logout individual
- [ ] Probar logout global desde múltiples dispositivos

## 🧪 Cómo Probar

### Prueba 1: Logout Individual

1. Inicia sesión en tu frontend
2. Haz clic en "Cerrar sesión"
3. Verifica que:
   - Se limpia el token del localStorage
   - Se redirige a `/login`
   - No puedes acceder a rutas protegidas

### Prueba 2: Logout Global

1. Inicia sesión en dispositivo 1 (laptop)
2. Inicia sesión en dispositivo 2 (teléfono)
3. Desde dispositivo 1, haz clic en "Cerrar todas las sesiones"
4. Verifica que:
   - Dispositivo 1: Se cierra la sesión y redirige a login
   - Dispositivo 2: Al hacer cualquier petición, recibe error 401 y se cierra la sesión

## 💡 Mejores Prácticas

1. **Siempre limpiar localmente**: Incluso si la petición falla, limpia el token del localStorage
2. **Confirmación para logout global**: Pide confirmación antes de cerrar todas las sesiones
3. **Mensajes claros**: Explica al usuario qué significa "cerrar todas las sesiones"
4. **Manejo de errores**: Muestra mensajes de error amigables
5. **Loading states**: Muestra un estado de carga mientras se procesa el logout

## 🎨 Estilos CSS (Opcional)

```css
/* Estilos para botones de logout */
.logout-btn {
  padding: 8px 16px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}

.logout-all-btn {
  padding: 8px 16px;
  background: #fff;
  border: 1px solid #dc3545;
  color: #dc3545;
  border-radius: 4px;
  cursor: pointer;
}

.logout-all-btn:hover {
  background: #dc3545;
  color: #fff;
}

.danger-zone {
  border: 2px solid #dc3545;
  border-radius: 8px;
  padding: 20px;
  margin-top: 20px;
}

.btn-danger {
  background: #dc3545;
  color: white;
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-danger:hover {
  background: #c82333;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  padding: 24px;
  border-radius: 8px;
  max-width: 400px;
  width: 90%;
}

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
```

## 📝 Resumen

1. **Logout individual**: `POST /api/auth/logout` con `{ logoutAll: false }`
2. **Logout global**: `POST /api/auth/logout-all` o `POST /api/auth/logout` con `{ logoutAll: true }`
3. **Siempre limpiar**: `localStorage.removeItem('token')` y `localStorage.removeItem('user')`
4. **Redirigir**: Enviar al usuario a `/login` después del logout
5. **Confirmación**: Pedir confirmación antes de logout global

¡Con esto tendrás el logout global completamente funcional en tu frontend! 🎉

