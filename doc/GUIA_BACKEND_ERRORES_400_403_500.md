# Guía: Cómo hacer funcionales los errores 400, 403 y 500

Esta guía indica **qué debe hacer el backend** para devolver 400, 403 y 500 en los casos correctos, y **cómo el frontend** puede usar las páginas `/400`, `/403` y `/500` cuando ocurran.

---

## Resumen rápido

| Código | Cuándo usarlo en el backend        | Página en el frontend |
|--------|------------------------------------|------------------------|
| **400** | Petición mal formada o validación fallida | `/400` |
| **403** | Sin permisos o acceso denegado     | `/403` |
| **500** | Error interno del servidor         | `/500` |

El backend debe responder con ese **status HTTP** y un JSON con `error` o `message`. El frontend puede redirigir a la página correspondiente cuando reciba ese status.

---

## 1. Error 400 (Bad Request)

### Cuándo devolver 400

- Datos del body inválidos o mal formados (JSON roto, campos con tipo incorrecto).
- **Validación fallida**: campos requeridos faltantes, formato de email/teléfono/fecha incorrecto, contraseña demasiado corta, etc.
- Reglas de negocio que se consideran “petición incorrecta”: por ejemplo, fecha de nacimiento futura, rango de fechas incoherente.
- **No** uses 400 para: credenciales incorrectas (401), sin permisos (403), recurso no encontrado (404).

### Formato de respuesta en el backend

Respuesta HTTP con **status 400** y cuerpo JSON. Ejemplo genérico:

```json
{
  "success": false,
  "error": "Mensaje claro para el usuario",
  "message": "Mensaje claro para el usuario"
}
```

Opcional: detalles por campo (útil para formularios):

```json
{
  "success": false,
  "error": "Hay errores de validación",
  "message": "Revisa los campos marcados",
  "errors": {
    "email": "El correo no es válido",
    "password": "La contraseña debe tener al menos 8 caracteres"
  }
}
```

### Ejemplos de código (backend)

**Express (Node.js):**

```javascript
// Validación de registro
if (!email || !password) {
  return res.status(400).json({
    success: false,
    error: 'Email y contraseña son obligatorios',
    message: 'Email y contraseña son obligatorios',
  });
}

if (password.length < 8) {
  return res.status(400).json({
    success: false,
    error: 'La contraseña debe tener al menos 8 caracteres',
    message: 'La contraseña debe tener al menos 8 caracteres',
  });
}

// Validación con detalles por campo
const errors = {};
if (!validator.isEmail(email)) errors.email = 'Correo no válido';
if (password.length < 8) errors.password = 'Mínimo 8 caracteres';
if (Object.keys(errors).length > 0) {
  return res.status(400).json({
    success: false,
    error: 'Errores de validación',
    message: 'Revisa los campos del formulario',
    errors,
  });
}
```

**NestJS (TypeScript):**

```typescript
throw new BadRequestException({
  success: false,
  error: 'La contraseña debe tener al menos 8 caracteres',
  message: 'La contraseña debe tener al menos 8 caracteres',
});
// Opcional con detalles:
throw new BadRequestException({
  success: false,
  error: 'Errores de validación',
  errors: { email: 'Correo no válido', password: 'Mínimo 8 caracteres' },
});
```

**Django (Python):**

```python
from rest_framework.response import Response
from rest_framework import status

return Response(
    {"success": False, "error": "Email y contraseña son obligatorios", "message": "Email y contraseña son obligatorios"},
    status=status.HTTP_400_BAD_REQUEST
)
```

---

## 2. Error 403 (Forbidden)

### Cuándo devolver 403

- El usuario **sí está autenticado** pero **no tiene permiso** para esa acción o recurso (rol, permisos RBAC).
- Cuenta bloqueada, suspendida o deshabilitada.
- **No** uses 403 para: “no has iniciado sesión” (eso es 401).

### Formato de respuesta en el backend

Respuesta HTTP con **status 403** y cuerpo JSON:

```json
{
  "success": false,
  "error": "No tienes permiso para realizar esta acción",
  "message": "No tienes permiso para realizar esta acción"
}
```

Ejemplos de mensajes útiles:

- `"No tienes permiso para acceder a este recurso"`
- `"Tu cuenta está bloqueada. Contacta al administrador"`
- `"Tu cuenta no tiene el rol necesario para esta acción"`

### Ejemplos de código (backend)

**Express (Node.js):**

```javascript
// Middleware de autorización por rol
const requireRole = (role) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  if (req.user.rol !== role) {
    return res.status(403).json({
      success: false,
      error: 'No tienes permiso para realizar esta acción',
      message: 'No tienes permiso para realizar esta acción',
    });
  }
  next();
};

// Uso en ruta
router.delete('/api/productos/:id', requireRole('admin'), eliminarProducto);

// Cuenta bloqueada
if (user.bloqueado) {
  return res.status(403).json({
    success: false,
    error: 'Tu cuenta está bloqueada',
    message: 'Tu cuenta está bloqueada. Contacta al administrador.',
  });
}
```

**NestJS (TypeScript):**

```typescript
import { ForbiddenException } from '@nestjs/common';

throw new ForbiddenException({
  success: false,
  error: 'No tienes permiso para realizar esta acción',
  message: 'No tienes permiso para realizar esta acción',
});
```

---

## 3. Error 500 (Internal Server Error)

### Cuándo devolver 500

- Excepción no controlada en el servidor.
- Fallo de base de datos, servicio externo o cualquier error que el usuario no puede corregir cambiando la petición.
- **No** uses 500 para validación (400) ni para “no encontrado” (404).

### Formato de respuesta en el backend

Respuesta HTTP con **status 500** y cuerpo JSON. No expongas detalles internos (stack, rutas) al cliente:

```json
{
  "success": false,
  "error": "Error interno del servidor",
  "message": "Algo salió mal. Por favor intenta más tarde."
}
```

En desarrollo puedes incluir más detalle en un campo opcional (por ejemplo `debug`), pero en producción no lo envíes.

### Ejemplos de código (backend)

**Express (Node.js):**

```javascript
// Middleware global de errores (al final de las rutas)
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  const isProd = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    success: false,
    error: isProd ? 'Error interno del servidor' : err.message,
    message: isProd ? 'Algo salió mal. Por favor intenta más tarde.' : err.message,
  });
});

// En un controlador, ante fallo inesperado
try {
  await algunaOperacion();
} catch (e) {
  console.error(e);
  return res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    message: 'Algo salió mal. Por favor intenta más tarde.',
  });
}
```

**NestJS (TypeScript):**

```typescript
// Los errores no capturados se pueden transformar en un filtro global
// Asegúrate de devolver status 500 y el mismo formato JSON
```

**Django (Python):**

```python
# settings.py: en producción no mostrar traceback al cliente
# En vista o middleware:
return Response(
    {"success": False, "error": "Error interno del servidor", "message": "Algo salió mal. Por favor intenta más tarde."},
    status=status.HTTP_500_INTERNAL_SERVER_ERROR
)
```

---

## 4. Cómo hace funcionales las páginas el frontend

El frontend ya tiene estas rutas que muestran una pantalla de error amigable:

- **`/400`** – Solicitud incorrecta
- **`/403`** – Acceso denegado
- **`/500`** – Error del servidor

Para que sean “funcionales” cuando el backend devuelve 400, 403 o 500, hay dos enfoques:

### Opción A: Redirigir desde el cliente API (recomendado para 403 y 500)

En `src/app/services/client.ts`, cuando `response.status` sea 400, 403 o 500, además de lanzar el error puedes redirigir a la página correspondiente **en ciertos casos** (por ejemplo solo 403 y 500, para no sacar al usuario del formulario en cada 400):

```typescript
// Dentro del bloque if (!response.ok), después de manejar 401 y 403 actual:
if (response.status === 403 && typeof window !== 'undefined') {
  window.location.href = '/403';
  throw new Error('Acceso denegado');
}
if (response.status === 500 && typeof window !== 'undefined') {
  window.location.href = '/500';
  throw new Error('Error del servidor');
}
// 400 normalmente se maneja en el formulario (mostrar mensajes), no redirigir siempre
```

Así, cuando el backend responda con 403 o 500, el usuario verá la página de error correspondiente.

### Opción B: Manejar el error en cada pantalla

En cada pantalla que llame al API, en el `catch` puedes leer `error.status` (si el cliente lo adjunta) y redirigir:

```typescript
catch (error: unknown) {
  const err = error as Error & { status?: number };
  if (err.status === 400) window.location.href = '/400';
  if (err.status === 403) window.location.href = '/403';
  if (err.status === 500) window.location.href = '/500';
}
```

---

## 5. Checklist para el backend

- [ ] **400**: Todas las validaciones de body/query (requeridos, formato, reglas de negocio) responden con `status 400` y JSON con `error` / `message` (y opcionalmente `errors` por campo).
- [ ] **403**: Rutas protegidas por rol/permiso responden con `status 403` cuando el usuario no tiene permiso; cuentas bloqueadas también devuelven 403 con mensaje claro.
- [ ] **500**: Errores no controlados y fallos de BD/servicios responden con `status 500` y un mensaje genérico, sin exponer detalles internos en producción.
- [ ] Todas las respuestas de error usan el mismo formato: `{ success: false, error: "...", message: "..." }` (y `errors` si aplica en 400).

Con esto, el backend hace “funcionales” los códigos 400, 403 y 500 y el frontend puede mostrar las páginas `/400`, `/403` y `/500` cuando corresponda.

---

## 6. Implementación en este backend (NestJS)

En este proyecto ya está aplicada la guía:

- **`src/common/filters/http-exception.filter.ts`**: Todas las excepciones devuelven `{ success: false, statusCode, timestamp, path, error, message }`. En 400 se incluye `errors` (objeto por campo) cuando la excepción lo trae. En 500 no se exponen detalles en producción.
- **`src/main.ts`**: El ValidationPipe usa `exceptionFactory` para que los fallos de validación lancen 400 con `{ success: false, error: 'Errores de validación', message: 'Revisa los campos del formulario', errors: { campo: 'mensaje' } }`.
- **400**: validación (DTO) y BadRequestException en servicios. **403**: ForbiddenException (RolesGuard, cuenta bloqueada). **500**: error no controlado; respuesta genérica en producción.
