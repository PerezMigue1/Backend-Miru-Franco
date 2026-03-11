# Configuración de CORS - Frontend

Este documento describe la configuración de CORS del backend para que el frontend pueda configurarse correctamente.

## 📋 Configuración del Backend

El backend está configurado con las siguientes opciones de CORS:

### Orígenes Permitidos

El backend permite solicitudes desde los siguientes orígenes:

- `https://miru-franco.vercel.app` (Producción)
- `https://miru-franco-pznm3jk0w-miru-franco.vercel.app` (Vercel Preview)
- `https://miru-franco-4pdg1kua8-miru-franco.vercel.app` (Vercel Preview)
- `https://miru-franco-hri9o928g-miru-franco.vercel.app` (Vercel Preview)
- `https://miru-franco-idhk1rz7d-miru-franco.vercel.app` (Vercel Preview)
- `http://localhost:3000` (Desarrollo local)
- `http://localhost:3001` (Desarrollo local)
- Valor de la variable de entorno `FRONTEND_URL` (si está configurada)

### Configuración de CORS

```typescript
{
  origin: (origin, callback) => {
    // Permitir solicitudes sin origin (ej: mobile apps, Postman)
    if (!origin) return callback(null, true);
    
    // Verificar si el origen está permitido
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Permitir todos temporalmente
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  exposedHeaders: ['Authorization'],
}
```

## 🔧 Configuración Requerida en el Frontend

### 1. Configurar Credenciales

**IMPORTANTE**: El backend tiene `credentials: true`, por lo que el frontend **DEBE** incluir `credentials: 'include'` en todas las solicitudes.

### 2. Ejemplo con Fetch API

```javascript
// Ejemplo de solicitud con fetch
fetch('https://tu-backend.com/api/endpoint', {
  method: 'GET',
  credentials: 'include', // ⚠️ OBLIGATORIO
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer tu-token-jwt', // Si es necesario
  },
});
```

### 3. Ejemplo con Axios

```javascript
import axios from 'axios';

// Configuración global de Axios
axios.defaults.withCredentials = true; // ⚠️ OBLIGATORIO

// O en cada solicitud individual
axios.get('https://tu-backend.com/api/endpoint', {
  withCredentials: true, // ⚠️ OBLIGATORIO
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer tu-token-jwt', // Si es necesario
  },
});
```

### 4. Ejemplo con Fetch en React

```javascript
// Hook personalizado para fetch con CORS
const useApi = () => {
  const fetchWithCors = async (url, options = {}) => {
    const response = await fetch(`https://tu-backend.com/api${url}`, {
      ...options,
      credentials: 'include', // ⚠️ OBLIGATORIO
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    return response.json();
  };
  
  return { fetchWithCors };
};
```

## 📝 Headers Permitidos

El backend acepta los siguientes headers en las solicitudes:

- `Content-Type`: Tipo de contenido (ej: `application/json`)
- `Authorization`: Token JWT (ej: `Bearer tu-token-jwt`)
- `X-Requested-With`: Identificador de solicitud AJAX
- `X-CSRF-Token`: Token CSRF (si está habilitado)

## 📤 Headers Expuestos

El backend expone los siguientes headers en las respuestas:

- `Authorization`: Token JWT (si se envía en la respuesta)

## 🔐 Métodos HTTP Permitidos

El backend permite los siguientes métodos HTTP:

- `GET`
- `POST`
- `PUT`
- `DELETE`
- `PATCH`
- `OPTIONS`

## ⚠️ Puntos Importantes

1. **Credenciales**: Siempre incluir `credentials: 'include'` o `withCredentials: true`
2. **Origen**: Asegurarse de que la URL del frontend esté en la lista de orígenes permitidos
3. **Headers**: Solo usar los headers permitidos en la lista
4. **Preflight**: Las solicitudes OPTIONS (preflight) son manejadas automáticamente por el backend

## 🐛 Solución de Problemas

### Error: "CORS policy: No 'Access-Control-Allow-Origin' header"

**Solución**: Verificar que:
- El frontend esté usando `credentials: 'include'`
- La URL del frontend esté en la lista de orígenes permitidos
- El backend esté configurado correctamente

### Error: "Credentials flag is 'true', but the 'Access-Control-Allow-Credentials' header is ''"

**Solución**: Asegurarse de incluir `credentials: 'include'` en todas las solicitudes del frontend.

### Error: "Request header field X-Custom-Header is not allowed"

**Solución**: Solo usar los headers permitidos:
- `Content-Type`
- `Authorization`
- `X-Requested-With`
- `X-CSRF-Token`

## 📞 Contacto

Si necesitas agregar un nuevo origen permitido, contacta al equipo de backend para actualizar la configuración de CORS.





