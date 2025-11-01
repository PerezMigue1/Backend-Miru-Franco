# 📡 Endpoints de la API - Backend Miru

## 🎯 URL Base

**Producción:** `https://backend-miru-franco.vercel.app/api/users`
**Desarrollo:** `http://localhost:3001/api/users`

---

## 🔐 Autenticación

### 1. Registro de Usuario
```
POST /api/users
Content-Type: application/json

Body:
{
  "nombre": "María González Pérez",
  "email": "maria.gonzalez@email.com",
  "telefono": "+521234567890",
  "password": "password123",
  "fechaNacimiento": "1995-05-15",
  "preguntaSeguridad": "¿Cuál era el nombre de tu primera mascota?",
  "direccion": {
    "calle": "Av. Insurgentes",
    "numero": "123",
    "colonia": "Del Valle",
    "codigoPostal": "03100",
    "referencia": "Entre calle A y calle B, edificio azul"
  },
  "perfilCapilar": {
    "tipoCabello": "rizado",
    "tieneAlergias": true,
    "alergias": "Alérgico a tintes con amoniaco",
    "tratamientosQuimicos": true,
    "tratamientos": "Alisado realizado hace 3 meses"
  },
  "aceptaAvisoPrivacidad": true,
  "recibePromociones": true
}

Response:
{
  "success": true,
  "message": "Usuario creado correctamente",
  "token": "eyJhbGc...",
  "usuario": {
    "_id": "507f1f77bcf86cd799439011",
    "nombre": "María González Pérez",
    "email": "maria.gonzalez@email.com"
  }
}
```

### 2. Login
```
POST /api/users/login
Content-Type: application/json

Body:
{
  "email": "maria.gonzalez@email.com",
  "password": "password123"
}

Response:
{
  "success": true,
  "message": "Inicio de sesión exitoso",
  "token": "eyJhbGc...",
  "usuario": {
    "_id": "507f1f77bcf86cd799439011",
    "nombre": "María González Pérez",
    "email": "maria.gonzalez@email.com"
  }
}
```

---

## 🔑 Recuperación de Contraseña

### Paso 1: Obtener Pregunta de Seguridad
```
POST /api/users/pregunta-seguridad
Content-Type: application/json

Body:
{
  "email": "maria.gonzalez@email.com"
}

Response:
{
  "success": true,
  "pregunta": "¿Cuál era el nombre de tu primera mascota?"
}
```

### Paso 2: Validar Respuesta
```
POST /api/users/verificar-respuesta
Content-Type: application/json

Body:
{
  "email": "maria.gonzalez@email.com",
  "respuesta": "Max"
}

Response:
{
  "success": true,
  "token": "abc123...",
  "email": "maria.gonzalez@email.com"
}
```

### Paso 3: Cambiar Contraseña
```
POST /api/users/cambiar-password
Content-Type: application/json

Body:
{
  "email": "maria.gonzalez@email.com",
  "token": "abc123...",
  "nuevaPassword": "nuevaPassword123"
}

Response:
{
  "success": true,
  "message": "Contraseña actualizada correctamente"
}
```

---

## 👤 CRUD de Usuarios

### 1. Obtener Todos los Usuarios
```
GET /api/users

Response:
{
  "success": true,
  "count": 25,
  "data": [...]
}
```

### 2. Obtener Usuario por ID
```
GET /api/users/:id

Response:
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "nombre": "María González Pérez",
    "email": "maria.gonzalez@email.com",
    "telefono": "+521234567890",
    ...
  }
}
```

### 3. Actualizar Usuario
```
PUT /api/users/:id
Content-Type: application/json

Body:
{
  "nombre": "María González",
  "telefono": "+529876543210"
}

Response:
{
  "success": true,
  "message": "Usuario actualizado correctamente",
  "data": {...}
}
```

### 4. Eliminar Usuario (Soft Delete)
```
DELETE /api/users/:id

Response:
{
  "success": true,
  "message": "Usuario eliminado correctamente"
}
```

---

## 👤 Perfil de Usuario

### 1. Obtener Perfil
```
GET /api/users/:id/perfil

Response:
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "nombre": "María González Pérez",
    "email": "maria.gonzalez@email.com",
    ...
  }
}
```

### 2. Actualizar Perfil
```
PUT /api/users/:id/perfil
Content-Type: application/json

Body:
{
  "nombre": "María González",
  "direccion": {
    "calle": "Nueva calle",
    ...
  },
  "perfilCapilar": {
    "tipoCabello": "ondulado"
  }
}

Response:
{
  "success": true,
  "message": "Perfil actualizado correctamente",
  "data": {...}
}
```

### 3. Cambiar Contraseña desde Perfil
```
PUT /api/users/:id/cambiar-password
Content-Type: application/json

Body:
{
  "actualPassword": "password123",
  "nuevaPassword": "newPassword456"
}

Response:
{
  "success": true,
  "message": "Contraseña actualizada correctamente"
}
```

---

## ❌ Códigos de Error

- `400` - Bad Request (datos inválidos o faltantes)
- `401` - Unauthorized (credenciales incorrectas)
- `403` - Forbidden (usuario inactivo)
- `404` - Not Found (recurso no encontrado)
- `500` - Internal Server Error (error del servidor)

---

## 📝 Notas Importantes

1. **Token JWT:** Guarda el token recibido en login/registro
2. **Expiración:** Tokens válidos por 1 día
3. **Recuperación:** Token temporal válido por 15 minutos
4. **Contraseñas:** Mínimo 6 caracteres, hasheadas con bcrypt
5. **Soft Delete:** Los usuarios no se eliminan físicamente, solo se marcan como inactivos
6. **Validación:** Email debe ser único y válido
7. **Campos obligatorios en registro:** nombre, email, telefono, password, fechaNacimiento, preguntaSeguridad, direccion, perfilCapilar, aceptaAvisoPrivacidad

---

## 🧪 Ejemplos con cURL

### Registro
```bash
curl -X POST https://backend-miru-franco.vercel.app/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Test User",
    "email": "test@example.com",
    "telefono": "+521234567890",
    "password": "password123",
    "fechaNacimiento": "1995-05-15",
    "preguntaSeguridad": "Test question",
    "direccion": {
      "calle": "Test Street",
      "numero": "123",
      "colonia": "Test Col",
      "codigoPostal": "12345",
      "referencia": "Test"
    },
    "perfilCapilar": {
      "tipoCabello": "liso",
      "tieneAlergias": false,
      "tratamientosQuimicos": false
    },
    "aceptaAvisoPrivacidad": true,
    "recibePromociones": false
  }'
```

### Login
```bash
curl -X POST https://backend-miru-franco.vercel.app/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### Obtener Usuarios
```bash
curl https://backend-miru-franco.vercel.app/api/users
```

