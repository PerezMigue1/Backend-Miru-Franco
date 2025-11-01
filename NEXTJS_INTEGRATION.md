# 🚀 Guía de Integración: Next.js + TypeScript + React con Backend Node/Express

## 📋 Stack Tecnológico

**Backend:**
- ✅ Node.js + Express
- ✅ MongoDB (Mongoose)
- ✅ Desplegado en Vercel: `https://backend-miru-franco.vercel.app`

**Frontend:**
- ✅ Next.js
- ✅ React
- ✅ TypeScript
- ✅ MongoDB (para consultas si es necesario)

---

## 🔧 Paso 1: Configurar Variables de Entorno en Next.js

### Crear `.env.local` en tu proyecto Next.js:

```env
# Backend API URL
NEXT_PUBLIC_API_URL=https://backend-miru-franco.vercel.app/api

# Para desarrollo local (si corres el backend localmente)
# NEXT_PUBLIC_API_URL=http://localhost:3001/api

# URL de la aplicación frontend
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Para producción en Vercel
# NEXT_PUBLIC_APP_URL=https://tu-frontend.vercel.app
```

---

## 📝 Paso 2: Crear Tipos TypeScript para la API

### Crear `src/types/api.ts`:

```typescript
// Tipos para Usuario
export interface Usuario {
  _id: string;
  nombre: string;
  email: string;
  telefono: string;
  fechaNacimiento: string;
  preguntaSeguridad: string;
  direccion: {
    calle: string;
    numero: string;
    colonia: string;
    codigoPostal: string;
    referencia?: string;
  };
  perfilCapilar: {
    tipoCabello: string;
    tieneAlergias: boolean;
    alergias?: string;
    tratamientosQuimicos: boolean;
    tratamientos?: string;
  };
  aceptaAvisoPrivacidad: boolean;
  recibePromociones: boolean;
  creadoEn: string;
  actualizadoEn: string;
  activo: boolean;
}

// Tipos para crear usuario
export interface CrearUsuarioDTO {
  nombre: string;
  email: string;
  telefono: string;
  password: string;
  fechaNacimiento: string;
  preguntaSeguridad: string;
  direccion: {
    calle: string;
    numero: string;
    colonia: string;
    codigoPostal: string;
    referencia?: string;
  };
  perfilCapilar: {
    tipoCabello: 'liso' | 'ondulado' | 'rizado' | 'muy rizado' | 'químico';
    tieneAlergias: boolean;
    alergias?: string;
    tratamientosQuimicos: boolean;
    tratamientos?: string;
  };
  aceptaAvisoPrivacidad: boolean;
  recibePromociones?: boolean;
}

// Tipos para login
export interface LoginDTO {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  token: string;
  usuario: {
    _id: string;
    nombre: string;
    email: string;
  };
}

// Tipos para respuestas de la API
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  count?: number;
  message?: string;
  error?: string;
}

export interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
}
```

---

## 🔌 Paso 3: Crear Cliente API para Next.js

### Crear `src/lib/api.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    // Agregar token si existe
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        };
      }
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Error en la solicitud');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Usuarios
  async obtenerUsuarios() {
    return this.request('/users');
  }

  async obtenerUsuarioPorId(id: string) {
    return this.request(`/users/${id}`);
  }

  async crearUsuario(data: any) {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async actualizarUsuario(id: string, data: any) {
    return this.request(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async eliminarUsuario(id: string) {
    return this.request(`/users/${id}`, {
      method: 'DELETE',
    });
  }

  // Autenticación
  async login(email: string, password: string) {
    return this.request('/users/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async registrar(data: any) {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Recuperación de contraseña
  async obtenerPreguntaSeguridad(email: string) {
    return this.request('/users/pregunta-seguridad', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async verificarRespuestaSeguridad(email: string, respuesta: string) {
    return this.request('/users/verificar-respuesta', {
      method: 'POST',
      body: JSON.stringify({ email, respuesta }),
    });
  }

  async cambiarPassword(email: string, token: string, nuevaPassword: string) {
    return this.request('/users/cambiar-password', {
      method: 'POST',
      body: JSON.stringify({ email, token, nuevaPassword }),
    });
  }

  // Perfil
  async obtenerPerfil(id: string) {
    return this.request(`/users/${id}/perfil`);
  }

  async actualizarPerfil(id: string, data: any) {
    return this.request(`/users/${id}/perfil`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async cambiarPasswordDesdePerfil(id: string, actualPassword: string, nuevaPassword: string) {
    return this.request(`/users/${id}/cambiar-password`, {
      method: 'PUT',
      body: JSON.stringify({ actualPassword, nuevaPassword }),
    });
  }
}

export const api = new ApiClient();
```

---

## ⚛️ Paso 4: Ejemplos de Uso en Componentes React

### Ejemplo 1: Login Component (`src/components/Login.tsx`):

```typescript
'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { LoginResponse } from '@/types/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.login(email, password) as LoginResponse;
      
      // Guardar token
      if (typeof window !== 'undefined') {
        localStorage.setItem('token', response.token);
      }

      // Redirigir o actualizar estado
      console.log('Login exitoso:', response.usuario);
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña"
        required
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
      </button>
    </form>
  );
}
```

### Ejemplo 2: Lista de Usuarios (`src/components/UserList.tsx`):

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Usuario, ApiResponse } from '@/types/api';

export default function UserList() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchUsuarios = async () => {
      try {
        const response = await api.obtenerUsuarios() as ApiResponse<Usuario[]>;
        setUsuarios(response.data || []);
      } catch (err: any) {
        setError(err.message || 'Error al cargar usuarios');
      } finally {
        setLoading(false);
      }
    };

    fetchUsuarios();
  }, []);

  if (loading) return <p>Cargando usuarios...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h2>Usuarios ({usuarios.length})</h2>
      <ul>
        {usuarios.map((usuario) => (
          <li key={usuario._id}>
            {usuario.nombre} - {usuario.email}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Ejemplo 3: Registro de Usuario (`src/components/Register.tsx`):

```typescript
'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { CrearUsuarioDTO } from '@/types/api';

export default function Register() {
  const [formData, setFormData] = useState<CrearUsuarioDTO>({
    nombre: '',
    email: '',
    telefono: '',
    password: '',
    fechaNacimiento: '',
    preguntaSeguridad: '',
    direccion: {
      calle: '',
      numero: '',
      colonia: '',
      codigoPostal: '',
      referencia: '',
    },
    perfilCapilar: {
      tipoCabello: 'liso',
      tieneAlergias: false,
      tratamientosQuimicos: false,
    },
    aceptaAvisoPrivacidad: false,
    recibePromociones: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await api.registrar(formData);
      console.log('Usuario creado:', response);
      // Redirigir o mostrar mensaje de éxito
    } catch (error: any) {
      console.error('Error al registrar:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Campos del formulario */}
      <button type="submit">Registrarse</button>
    </form>
  );
}
```

---

## 🔐 Paso 5: Configurar CORS en el Backend (Ya está hecho ✅)

Tu backend ya tiene CORS configurado con `origin: '*'` en `server.js`, lo cual permite conexiones desde cualquier origen. Esto está bien para desarrollo.

Para producción, puedes restringir a tu dominio de Vercel si lo deseas.

---

## 🌐 Paso 6: Configurar Variables en Vercel (Frontend)

Cuando despliegues tu frontend en Vercel:

1. Ve a tu proyecto en Vercel
2. **Settings** → **Environment Variables**
3. Agrega:
   - `NEXT_PUBLIC_API_URL`: `https://backend-miru-franco.vercel.app/api`
   - `NEXT_PUBLIC_APP_URL`: `https://tu-frontend.vercel.app`

---

## ✅ Checklist de Integración

- [ ] Variables de entorno configuradas en `.env.local`
- [ ] Tipos TypeScript creados
- [ ] Cliente API configurado
- [ ] Componentes React usando el cliente API
- [ ] Token JWT se guarda en `localStorage` después del login
- [ ] CORS configurado en el backend (✅ ya está)
- [ ] Backend desplegado en Vercel (✅ ya está)
- [ ] Variables de entorno configuradas en Vercel para producción

---

## 🧪 Probar la Conexión

### Desde tu componente Next.js:

```typescript
'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

export default function TestConnection() {
  useEffect(() => {
    const test = async () => {
      try {
        const response = await api.obtenerUsuarios();
        console.log('✅ Conexión exitosa:', response);
      } catch (error) {
        console.error('❌ Error de conexión:', error);
      }
    };
    test();
  }, []);

  return <div>Probando conexión...</div>;
}
```

---

## 🐛 Solución de Problemas

### Error: "Failed to fetch" o CORS
- Verifica que el backend esté corriendo
- Verifica que `NEXT_PUBLIC_API_URL` esté correctamente configurado
- Revisa la consola del navegador para más detalles

### Error: "401 Unauthorized"
- Verifica que el token se esté enviando en los headers
- Verifica que el token no haya expirado
- Revisa que el formato del token sea correcto

### Error: "404 Not Found"
- Verifica que la ruta del endpoint sea correcta
- Verifica que el backend esté desplegado y funcionando
- Revisa los logs de Vercel

---

## 📚 Recursos Adicionales

- [Next.js Environment Variables](https://nextjs.org/docs/basic-features/environment-variables)
- [TypeScript en Next.js](https://nextjs.org/docs/basic-features/typescript)
- [Fetch API](https://developer.mozilla.org/es/docs/Web/API/Fetch_API)

