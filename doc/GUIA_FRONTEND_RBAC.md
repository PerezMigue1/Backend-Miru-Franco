# 🔐 Guía Frontend: Actualizar para Control de Acceso (RBAC)

## 📋 Resumen

El backend ahora valida roles con **RBAC**. Para algunos endpoints, solo el rol `admin` tiene acceso.  
Si un usuario sin rol `admin` intenta acceder, el backend responde, por ejemplo:

```json
{
  "statusCode": 403,
  "message": "No tienes permisos para acceder a este recurso",
  "error": "Forbidden"
}
```

Tu tarea en el frontend es:

1. Leer y guardar el `rol` del usuario cuando hace login.
2. Ocultar/mostrar botones y pantallas según el `rol`.
3. Manejar errores `403` mostrando un mensaje amigable.

---

## 1. Estructura esperada del usuario en el frontend

Cuando el usuario inicia sesión, el backend devuelve algo así (ejemplo):

```json
{
  "success": true,
  "message": "Inicio de sesión exitoso",
  "token": "<JWT>",
  "usuario": {
    "_id": "uuid-usuario",
    "nombre": "Admin",
    "email": "admin@test.com",
    "rol": "admin"
  }
}
```

En el frontend, guarda tanto el `token` como el `usuario`:

```ts
// Ejemplo con localStorage
localStorage.setItem('token', response.data.token);
localStorage.setItem('user', JSON.stringify(response.data.usuario));
```

Asegúrate de que el backend ya incluya el campo `rol` en la respuesta.

---

## 2. Leer el rol del usuario en el frontend

```ts
export function getCurrentUser() {
  if (typeof window === 'undefined') return null;
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// Ejemplo de uso
const user = getCurrentUser();
const rol = user?.rol; // 'admin', 'empleado', 'estilista', 'cliente', 'becario'
```

Puedes adaptar `getCurrentUser` a tu sistema (Context, Redux, Zustand, etc.).

---

## 3. Ocultar/mostrar UI según el rol

### 3.1. Botones de administración (solo `admin`)

```tsx
import { useRouter } from 'next/router'; // o useNavigate de React Router
import { getCurrentUser } from '../utils/auth';

export function AdminMenu() {
  const router = useRouter();
  const user = getCurrentUser();
  const isAdmin = user?.rol === 'admin';

  if (!isAdmin) return null; // Ocultar completamente el menú si no es admin

  return (
    <div>
      <h3>Panel de Administración</h3>
      <button onClick={() => router.push('/admin/usuarios')}>
        Gestionar usuarios
      </button>
      <button onClick={() => router.push('/admin/productos')}>
        Gestionar productos
      </button>
      {/* Agregar aquí más accesos directos para admin */}
    </div>
  );
}
```

### 3.2. Proteger páginas de administración por rol

Ejemplo con **Next.js**:

```tsx
// pages/admin/usuarios.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import api from '../../utils/axios'; // tu instancia de Axios
import { getCurrentUser } from '../../utils/auth';

export default function AdminUsuariosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<any[]>([]);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    if (user.rol !== 'admin') {
      setError('No tienes permisos para ver esta página.');
      setLoading(false);
      // Opcional: redirigir después de unos segundos
      setTimeout(() => router.push('/'), 3000);
      return;
    }

    // El usuario es admin → cargar datos
    cargarUsuarios();
  }, []);

  const cargarUsuarios = async () => {
    try {
      const response = await api.get('/usuarios'); // GET /api/usuarios (solo admin)
      setUsuarios(response.data);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('No tienes permisos para ver esta información.');
      } else {
        setError('Error al cargar usuarios.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Cargando...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div>
      <h1>Usuarios</h1>
      {/* Renderizar la tabla/lista de usuarios aquí */}
    </div>
  );
}
```

---

## 4. Manejo global de errores 403 (opcional)

Si usas **Axios**, puedes centralizar el manejo de errores `403` en la instancia de `api`:

```ts
// utils/axios.ts
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      const message = error.response?.data?.message || 'No tienes permisos para realizar esta acción.';
      // Aquí puedes usar tu sistema de notificaciones/toast
      console.warn('⚠️ Acceso denegado:', message);
      // Opcional: redirigir a una página de acceso denegado
      // window.location.href = '/403';
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

## 5. Endpoints que el backend protege solo para `admin`

Actualmente, el backend ya marca estos endpoints como **solo admin** usando `RolesGuard`:

```ts
// src/usuarios/usuarios.controller.ts

// GET /api/usuarios → lista todos los usuarios
@Get()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
async obtenerUsuarios() { ... }

// PUT /api/usuarios/:id → actualizar usuario
@Put(':id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
async actualizarUsuario(...) { ... }

// DELETE /api/usuarios/:id → eliminar usuario
@Delete(':id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
async eliminarUsuario(...) { ... }
```

En el frontend, cualquier pantalla que consuma estos endpoints debe estar restringida a usuarios con `rol === 'admin'`.

---

## 📋 Checklist para el Frontend

- [ ] Asegurarse de que el backend devuelve el campo `rol` en la respuesta de login.
- [ ] Guardar `usuario.rol` junto con el token en el almacenamiento (localStorage, Context, Redux, etc.).
- [ ] Ocultar el menú de administración si `rol !== 'admin'`.
- [ ] Proteger las páginas `/admin/*` verificando el rol antes de cargar datos.
- [ ] Manejar errores `403` mostrando un mensaje de “No tienes permisos…”.

---

## ✅ Resumen Final

1. El backend ya valida roles y bloquea endpoints solo-admin con `403 Forbidden`.
2. El frontend debe:
   - Leer y guardar el rol del usuario.
   - Mostrar u ocultar secciones según el rol.
   - Manejar los errores `403` de forma amigable.
3. Con esto, se cumple el criterio de la lista de cotejo:
   - **“Intentar acceder a recurso admin con usuario estándar. Acceso debe ser denegado.”**

