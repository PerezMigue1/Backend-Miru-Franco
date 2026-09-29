# Configuración de CORS - Frontend

Este documento describe la configuración de CORS del backend para que el frontend pueda configurarse correctamente.

## 📋 Configuración del Backend

El backend está configurado con las siguientes opciones de CORS:

### Orígenes Permitidos

La lista blanca vive en `src/config/cors.config.ts` (única fuente). Un origen que no esté en ella se rechaza (el navegador bloquea la respuesta):

- `https://www.mirufranco.com` y `https://mirufranco.com` (producción)
- `http://localhost:3000` (solo cuando `NODE_ENV` no es `production`)
- Valor de `FRONTEND_URL` (si es una URL válida)
- Orígenes exactos listados en `CORS_ALLOWED_ORIGINS`, separados por comas (p. ej. un dominio de preview de Vercel). `*` y valores no válidos se ignoran.

Las peticiones sin cabecera `Origin` (servidor a servidor, apps, curl) no se ven afectadas por CORS.

### Configuración de CORS

Ver `crearCorsOptions()` en `src/config/cors.config.ts`: `credentials: true`, métodos `GET, POST, PUT, DELETE, PATCH, OPTIONS` y cabeceras `Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Last-Event-ID, X-Auth-Mode`.

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





