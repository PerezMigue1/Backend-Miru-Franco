# 📚 Documentación Técnica - Backend Miru Franco

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [APIs y Endpoints](#apis-y-endpoints)
4. [Configuraciones](#configuraciones)
5. [Modelos de Datos](#modelos-de-datos)
6. [Autenticación y Autorización](#autenticación-y-autorización)
7. [Código de Ejemplo](#código-de-ejemplo)
8. [Guías de Implementación](#guías-de-implementación)

---

## Introducción

### Descripción del Proyecto

Backend API REST desarrollado con **NestJS**, **TypeScript** y **Prisma** para Miru Franco Beauty Salón. El sistema proporciona gestión completa de usuarios, autenticación multifactor, y recuperación de contraseñas mediante preguntas de seguridad.

### Tecnologías Principales

- **Framework**: NestJS v10
- **Lenguaje**: TypeScript v5.1.3
- **ORM**: Prisma v5.22.0
- **Base de Datos**: PostgreSQL (Neon)
- **Autenticación**: JWT, Passport.js (Google OAuth)
- **Email**: SendGrid
- **Deployment**: Render
- **Node.js**: v18 o superior

### URLs del Sistema

**Producción:**
- Backend: `https://miru-franco.onrender.com`
- Frontend: `https://miru-franco.vercel.app`

**Desarrollo:**
- Backend: `http://localhost:3001`
- Frontend: `http://localhost:3000`

---

## Arquitectura del Sistema

### Estructura del Proyecto

```
backend-miru/
├── src/
│   ├── main.ts                      # Punto de entrada y configuración global
│   ├── app.module.ts                # Módulo raíz de la aplicación
│   ├── app.controller.ts            # Controlador principal
│   ├── config/
│   │   └── database.config.ts       # Configuración de base de datos
│   ├── prisma/
│   │   ├── prisma.module.ts         # Módulo de Prisma
│   │   └── prisma.service.ts        # Servicio de Prisma
│   ├── usuarios/
│   │   ├── usuarios.module.ts
│   │   ├── usuarios.controller.ts   # Controlador de usuarios
│   │   ├── usuarios.service.ts      # Lógica de negocio
│   │   └── dto/                     # Data Transfer Objects
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts       # Controlador de autenticación
│   │   ├── auth.service.ts          # Lógica de autenticación
│   │   └── strategies/              # Estrategias de Passport
│   │       ├── jwt.strategy.ts      # Estrategia JWT
│   │       └── google.strategy.ts   # Estrategia Google OAuth
│   ├── pregunta-seguridad/
│   │   ├── pregunta-seguridad.module.ts
│   │   ├── pregunta-seguridad.controller.ts
│   │   ├── pregunta-seguridad.service.ts
│   │   └── dto/
│   ├── email/
│   │   ├── email.module.ts
│   │   └── email.service.ts         # Servicio de SendGrid
│   └── common/
│       ├── guards/                  # Guards de autenticación/autorización
│       ├── filters/                 # Filtros de excepciones
│       ├── decorators/              # Decoradores personalizados
│       ├── services/                # Servicios compartidos
│       ├── middleware/              # Middleware personalizado
│       └── validators/              # Validadores personalizados
├── prisma/
│   ├── schema.prisma                # Schema de Prisma
│   └── migrations/                  # Migraciones de base de datos
├── scripts/                         # Scripts de utilidad
├── dist/                            # Código compilado (TypeScript → JavaScript)
├── package.json
├── tsconfig.json                    # Configuración de TypeScript
├── nest-cli.json                    # Configuración de NestJS CLI
└── render.yaml                      # Configuración de despliegue en Render
```

### Flujo de Autenticación

```
1. Registro/Login → 2. Verificación OTP → 3. Token JWT → 4. Acceso Protegido
                     ↓
              (Opcional: Google OAuth)
```

---

## APIs y Endpoints

### Prefijo Global

Todas las rutas de la API tienen el prefijo `/api`, excepto:
- `/` - Información del API
- `/salud` - Health check

### Formato de Respuestas

#### Respuesta Exitosa
```json
{
  "success": true,
  "message": "Operación exitosa",
  "data": { ... }
}
```

#### Respuesta de Error
```json
{
  "success": false,
  "message": "Mensaje de error",
  "error": "Tipo de error",
  "statusCode": 400
}
```

---

### 🔐 Módulo de Autenticación (`/api/auth`)

#### 1. Iniciar Autenticación con Google

**Endpoint:** `GET /api/auth/google`

**Descripción:** Inicia el flujo de autenticación OAuth con Google. Redirige al usuario a la página de autenticación de Google.

**Autenticación:** No requerida

**Respuesta:** Redirección HTTP 302 a Google OAuth

**Ejemplo de uso:**
```javascript
// En el frontend, redirigir al usuario a esta URL
window.location.href = 'https://miru-franco.onrender.com/api/auth/google';
```

---

#### 2. Callback de Google OAuth

**Endpoint:** `GET /api/auth/google/callback`

**Descripción:** Callback que recibe la respuesta de Google después de la autenticación. Procesa el código de autorización y redirige al frontend con un código temporal.

**Autenticación:** No requerida (maneja Passport internamente)

**Respuesta:** Redirección HTTP 302 al frontend con código temporal

**Ejemplo de redirección:**
```
https://miru-franco.vercel.app/auth/callback?code=TEMPORAL_CODE_123&success=true
```

---

#### 3. Intercambiar Código por Token

**Endpoint:** `POST /api/auth/exchange-code`

**Descripción:** Intercambia el código temporal de OAuth por un token JWT. Este endpoint es seguro y no expone el token en la URL.

**Autenticación:** No requerida

**Request Body:**
```json
{
  "code": "TEMPORAL_CODE_123"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Autenticación exitosa",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "usuario": {
      "id": "uuid",
      "email": "usuario@example.com",
      "nombre": "Juan Pérez",
      "rol": "usuario"
    }
  }
}
```

**Ejemplo de código:**
```javascript
const response = await fetch('https://miru-franco.onrender.com/api/auth/exchange-code', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    code: urlParams.get('code') // Obtener código de la URL
  })
});

const data = await response.json();
localStorage.setItem('token', data.data.token);
```

---

#### 4. Verificar Correo Existente

**Endpoint:** `POST /api/auth/verificar-correo`

**Descripción:** Verifica si un correo electrónico ya está registrado en el sistema.

**Autenticación:** No requerida

**Request Body:**
```json
{
  "correo": "usuario@example.com"
}
```

**Response 200:**
```json
{
  "existe": true,
  "message": "El correo ya está registrado"
}
```

**Ejemplo de código:**
```javascript
const response = await fetch('https://miru-franco.onrender.com/api/auth/verificar-correo', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    correo: 'usuario@example.com'
  })
});

const data = await response.json();
if (data.existe) {
  console.log('El correo ya está registrado');
}
```

---

#### 5. Obtener Perfil del Usuario Autenticado

**Endpoint:** `GET /api/auth/me`

**Descripción:** Obtiene el perfil del usuario actualmente autenticado.

**Autenticación:** JWT requerida

**Headers:**
```
Authorization: Bearer <token>
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "usuario@example.com",
    "nombre": "Juan Pérez",
    "telefono": "+521234567890",
    "rol": "usuario",
    "confirmado": true,
    "fechaNacimiento": "1990-01-01T00:00:00.000Z",
    "foto": "https://...",
    "aceptaAvisoPrivacidad": true,
    "recibePromociones": false,
    "activo": true,
    "creadoEn": "2024-01-01T00:00:00.000Z",
    "actualizadoEn": "2024-01-01T00:00:00.000Z"
  }
}
```

**Ejemplo de código:**
```javascript
const token = localStorage.getItem('token');

const response = await fetch('https://miru-franco.onrender.com/api/auth/me', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  credentials: 'include'
});

const data = await response.json();
console.log('Usuario:', data.data);
```

---

#### 6. Cerrar Sesión

**Endpoint:** `POST /api/auth/logout`

**Descripción:** Cierra la sesión del usuario actual, invalidando el token JWT.

**Autenticación:** JWT requerida

**Request Body (opcional):**
```json
{
  "logoutAll": false  // Si es true, cierra todas las sesiones del usuario
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Sesión cerrada correctamente"
}
```

**Ejemplo de código:**
```javascript
const token = localStorage.getItem('token');

const response = await fetch('https://miru-franco.onrender.com/api/auth/logout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    logoutAll: false
  })
});

localStorage.removeItem('token');
```

---

#### 7. Cerrar Todas las Sesiones

**Endpoint:** `POST /api/auth/logout-all`

**Descripción:** Cierra todas las sesiones activas del usuario, invalidando todos los tokens emitidos.

**Autenticación:** JWT requerida

**Response 200:**
```json
{
  "success": true,
  "message": "Todas las sesiones han sido cerradas"
}
```

---

#### 8. Refrescar Token

**Endpoint:** `POST /api/auth/refresh`

**Descripción:** Genera un nuevo token JWT para el usuario autenticado.

**Autenticación:** JWT requerida

**Response 200:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 👥 Módulo de Usuarios (`/api/usuarios`)

#### 1. Registrar Usuario

**Endpoint:** `POST /api/usuarios/registrar`  
**Alias:** `POST /api/usuarios` o `POST /api/usuarios/registro`

**Descripción:** Crea un nuevo usuario en el sistema. Se envía un código OTP al correo electrónico para verificación.

**Autenticación:** No requerida

**Request Body:**
```json
{
  "nombre": "Juan Pérez",
  "email": "juan@example.com",
  "password": "Password123!",
  "telefono": "+521234567890",
  "fechaNacimiento": "1990-01-01",
  "aceptaAvisoPrivacidad": true,
  "recibePromociones": false,
  "preguntaSeguridad": "¿Cuál es el nombre de tu mascota?",
  "respuestaSeguridad": "Fluffy"
}
```

**Campos Requeridos:**
- `nombre` (string): Nombre completo del usuario
- `email` (string): Correo electrónico válido y único
- `password` (string): Contraseña (mínimo 8 caracteres, al menos 1 mayúscula, 1 minúscula, 1 número)

**Campos Opcionales:**
- `telefono` (string)
- `fechaNacimiento` (string, formato ISO 8601)
- `aceptaAvisoPrivacidad` (boolean, default: false)
- `recibePromociones` (boolean, default: false)
- `preguntaSeguridad` (string): Pregunta de seguridad personalizada
- `respuestaSeguridad` (string): Respuesta a la pregunta de seguridad (se hashea automáticamente)

**Response 201:**
```json
{
  "success": true,
  "message": "Usuario registrado correctamente. Se ha enviado un código de verificación a tu correo.",
  "data": {
    "id": "uuid",
    "email": "juan@example.com",
    "nombre": "Juan Pérez",
    "confirmado": false
  }
}
```

**Ejemplo de código:**
```javascript
const response = await fetch('https://miru-franco.onrender.com/api/usuarios/registrar', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    nombre: 'Juan Pérez',
    email: 'juan@example.com',
    password: 'Password123!',
    aceptaAvisoPrivacidad: true
  })
});

const data = await response.json();
if (data.success) {
  console.log('Usuario registrado, verificar email');
}
```

---

#### 2. Iniciar Sesión

**Endpoint:** `POST /api/usuarios/login`

**Descripción:** Autentica un usuario con email y contraseña. Implementa protección contra fuerza bruta y bloqueo de cuenta.

**Autenticación:** No requerida

**Rate Limiting:** 5 intentos por minuto por IP

**Request Body:**
```json
{
  "email": "juan@example.com",
  "password": "Password123!"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Credenciales válidas. Se ha enviado un código OTP a tu correo.",
  "data": {
    "email": "juan@example.com",
    "requiereOTP": true
  }
}
```

**Response 401 (Credenciales inválidas):**
```json
{
  "success": false,
  "message": "Credenciales inválidas",
  "statusCode": 401
}
```

**Response 429 (Demasiados intentos):**
```json
{
  "success": false,
  "message": "Demasiados intentos. Intenta de nuevo en 1 minuto.",
  "statusCode": 429
}
```

**Ejemplo de código:**
```javascript
const response = await fetch('https://miru-franco.onrender.com/api/usuarios/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    email: 'juan@example.com',
    password: 'Password123!'
  })
});

const data = await response.json();
if (data.success && data.data.requiereOTP) {
  // Mostrar formulario para ingresar OTP
}
```

---

#### 3. Verificar Código OTP

**Endpoint:** `POST /api/usuarios/verificar-otp`

**Descripción:** Verifica el código OTP enviado por email y genera un token JWT si es válido.

**Autenticación:** No requerida

**Request Body:**
```json
{
  "email": "juan@example.com",
  "codigo": "123456"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Código OTP verificado correctamente",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "usuario": {
      "id": "uuid",
      "email": "juan@example.com",
      "nombre": "Juan Pérez",
      "rol": "usuario",
      "confirmado": true
    }
  }
}
```

**Response 400 (Código inválido o expirado):**
```json
{
  "success": false,
  "message": "Código OTP inválido o expirado",
  "statusCode": 400
}
```

**Ejemplo de código:**
```javascript
const response = await fetch('https://miru-franco.onrender.com/api/usuarios/verificar-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',
  body: JSON.stringify({
    email: 'juan@example.com',
    codigo: '123456'
  })
});

const data = await response.json();
if (data.success) {
  localStorage.setItem('token', data.data.token);
  // Redirigir al dashboard
}
```

---

#### 4. Reenviar Código OTP

**Endpoint:** `POST /api/usuarios/reenviar-codigo`

**Descripción:** Reenvía un nuevo código OTP al correo electrónico del usuario.

**Autenticación:** No requerida

**Rate Limiting:** 3 intentos por minuto

**Request Body:**
```json
{
  "email": "juan@example.com"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Se ha reenviado el código de verificación a tu correo"
}
```

---

#### 5. Obtener Pregunta de Seguridad

**Endpoint:** `POST /api/usuarios/pregunta-seguridad`

**Descripción:** Obtiene la pregunta de seguridad de un usuario para recuperación de contraseña.

**Autenticación:** No requerida

**Rate Limiting:** 3 intentos por minuto (previene enumeración de usuarios)

**Request Body:**
```json
{
  "email": "juan@example.com"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "pregunta": "¿Cuál es el nombre de tu mascota?"
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Usuario no encontrado o no tiene pregunta de seguridad configurada",
  "statusCode": 404
}
```

---

#### 6. Verificar Respuesta de Seguridad

**Endpoint:** `POST /api/usuarios/verificar-respuesta`

**Descripción:** Verifica la respuesta de seguridad y genera un token temporal para recuperar contraseña.

**Autenticación:** No requerida

**Request Body:**
```json
{
  "email": "juan@example.com",
  "respuesta": "Fluffy"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Respuesta correcta",
  "data": {
    "token": "temporary_reset_token_123",
    "email": "juan@example.com"
  }
}
```

---

#### 7. Cambiar Contraseña

**Endpoint:** `POST /api/usuarios/cambiar-password`

**Descripción:** Cambia la contraseña de un usuario usando el token de recuperación.

**Autenticación:** No requerida (usa token de recuperación)

**Request Body:**
```json
{
  "email": "juan@example.com",
  "token": "temporary_reset_token_123",
  "nuevaPassword": "NewPassword123!"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Contraseña cambiada correctamente"
}
```

---

#### 8. Obtener Usuario por ID

**Endpoint:** `GET /api/usuarios/:id`

**Descripción:** Obtiene la información de un usuario específico.

**Autenticación:** JWT requerida

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "nombre": "Juan Pérez",
    "email": "juan@example.com",
    "telefono": "+521234567890",
    "rol": "usuario",
    "activo": true,
    "confirmado": true,
    "creadoEn": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### 9. Obtener Perfil de Usuario

**Endpoint:** `GET /api/usuarios/:id/perfil`

**Descripción:** Obtiene el perfil completo de un usuario (incluye información de dirección y perfil capilar).

**Autenticación:** JWT requerida

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "nombre": "Juan Pérez",
    "email": "juan@example.com",
    "telefono": "+521234567890",
    "fechaNacimiento": "1990-01-01T00:00:00.000Z",
    "direccion": {
      "calle": "Calle Principal",
      "numero": "123",
      "colonia": "Centro",
      "ciudad": "Ciudad de México",
      "estado": "CDMX",
      "codigoPostal": "01000"
    },
    "perfilCapilar": {
      "tipoCabello": "rizado",
      "colorNatural": "Negro",
      "colorActual": "Rubio",
      "productosUsados": "Champú orgánico",
      "alergias": "Ninguna"
    }
  }
}
```

---

#### 10. Actualizar Perfil de Usuario

**Endpoint:** `PUT /api/usuarios/:id/perfil`

**Descripción:** Actualiza el perfil de un usuario.

**Autenticación:** JWT requerida

**Request Body:**
```json
{
  "nombre": "Juan Pérez Actualizado",
  "telefono": "+521234567890",
  "fechaNacimiento": "1990-01-01",
  "calle": "Nueva Calle",
  "numero": "456",
  "colonia": "Nueva Colonia",
  "ciudad": "Ciudad de México",
  "estado": "CDMX",
  "codigoPostal": "01000",
  "tipoCabello": "ondulado",
  "colorNatural": "Castaño",
  "recibePromociones": true
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Perfil actualizado correctamente",
  "data": { ... }
}
```

---

#### 11. Cambiar Contraseña desde Perfil

**Endpoint:** `PUT /api/usuarios/:id/cambiar-password`

**Descripción:** Permite a un usuario cambiar su contraseña desde su perfil (requiere contraseña actual).

**Autenticación:** JWT requerida

**Request Body:**
```json
{
  "actualPassword": "OldPassword123!",
  "nuevaPassword": "NewPassword123!"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Contraseña cambiada correctamente"
}
```

---

#### 12. Obtener Todos los Usuarios

**Endpoint:** `GET /api/usuarios`

**Descripción:** Obtiene la lista de todos los usuarios (solo para administradores).

**Autenticación:** JWT requerida

**Autorización:** Solo usuarios con rol `admin`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "nombre": "Juan Pérez",
      "email": "juan@example.com",
      "rol": "usuario",
      "activo": true
    },
    ...
  ]
}
```

---

#### 13. Actualizar Usuario (Admin)

**Endpoint:** `PUT /api/usuarios/:id`

**Descripción:** Actualiza cualquier campo de un usuario (solo para administradores).

**Autenticación:** JWT requerida

**Autorización:** Solo usuarios con rol `admin`

---

#### 14. Eliminar Usuario

**Endpoint:** `DELETE /api/usuarios/:id`

**Descripción:** Elimina un usuario del sistema (solo para administradores).

**Autenticación:** JWT requerida

**Autorización:** Solo usuarios con rol `admin`

**Response 200:**
```json
{
  "success": true,
  "message": "Usuario eliminado correctamente"
}
```

---

### ❓ Módulo de Preguntas de Seguridad (`/api/pregunta-seguridad`)

#### 1. Obtener Todas las Preguntas Disponibles

**Endpoint:** `GET /api/pregunta-seguridad`

**Descripción:** Obtiene la lista de todas las preguntas de seguridad predefinidas disponibles.

**Autenticación:** No requerida

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "pregunta": "¿Cuál es el nombre de tu mascota?",
      "activa": true
    },
    {
      "id": "uuid",
      "pregunta": "¿Cuál es el nombre de tu ciudad natal?",
      "activa": true
    }
  ]
}
```

---

#### 2. Obtener Pregunta por Email

**Endpoint:** `GET /api/pregunta-seguridad/por-email?email=usuario@example.com`

**Descripción:** Obtiene la pregunta de seguridad configurada por un usuario específico.

**Autenticación:** No requerida

**Query Parameters:**
- `email` (string, requerido): Correo electrónico del usuario

**Response 200:**
```json
{
  "success": true,
  "data": {
    "pregunta": "¿Cuál es el nombre de tu mascota?"
  }
}
```

---

#### 3. Crear Pregunta de Seguridad

**Endpoint:** `POST /api/pregunta-seguridad`

**Descripción:** Crea una nueva pregunta de seguridad para un usuario.

**Autenticación:** JWT requerida

**Request Body:**
```json
{
  "pregunta": "¿Cuál es el nombre de tu mascota?",
  "email": "juan@example.com",
  "respuesta": "Fluffy"
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "Pregunta de seguridad creada correctamente"
}
```

---

#### 4. Verificar Respuesta

**Endpoint:** `POST /api/pregunta-seguridad/verificar`

**Descripción:** Verifica una respuesta a una pregunta de seguridad.

**Autenticación:** No requerida

**Request Body:**
```json
{
  "email": "juan@example.com",
  "answers": {
    "pregunta1": "Respuesta 1",
    "pregunta2": "Respuesta 2"
  }
}
```

---

#### 5. Obtener Pregunta por ID

**Endpoint:** `GET /api/pregunta-seguridad/:id`

**Descripción:** Obtiene una pregunta de seguridad por su ID.

**Autenticación:** JWT requerida

---

#### 6. Actualizar Pregunta

**Endpoint:** `PUT /api/pregunta-seguridad/:id`

**Descripción:** Actualiza una pregunta de seguridad.

**Autenticación:** JWT requerida

---

#### 7. Eliminar Pregunta

**Endpoint:** `DELETE /api/pregunta-seguridad/:id`

**Descripción:** Elimina una pregunta de seguridad.

**Autenticación:** JWT requerida

---

### 📊 Endpoints Adicionales

#### Health Check

**Endpoint:** `GET /salud`

**Descripción:** Verifica el estado del servidor.

**Autenticación:** No requerida

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 3600.5
}
```

---

#### Información del API

**Endpoint:** `GET /`

**Descripción:** Obtiene información general sobre el API.

**Autenticación:** No requerida

**Response 200:**
```json
{
  "message": "Miru Franco Backend API",
  "version": "1.0.0",
  "status": "running",
  "documentation": "https://github.com/PerezMigue1/Backend-Miru-Franco",
  "endpoints": {
    "health": "/salud",
    "api": "/api",
    "usuarios": "/api/usuarios",
    "auth": {
      "google": "/api/auth/google",
      "verifyEmail": "/api/auth/verificar-correo",
      "me": "/api/auth/me"
    },
    "seguridad": "/api/pregunta-seguridad"
  }
}
```

---

## Configuraciones

### Variables de Entorno

El sistema utiliza variables de entorno para configuración. Crea un archivo `.env` en la raíz del proyecto:

```env
# ============================================
# CONFIGURACIÓN DE BASE DE DATOS
# ============================================
DATABASE_URL=postgresql://username:password@host.neon.tech/database?sslmode=require

# ============================================
# CONFIGURACIÓN JWT
# ============================================
JWT_SECRET=tu_secreto_jwt_muy_seguro_aqui_minimo_32_caracteres
JWT_EXPIRES_IN=7d  # Tiempo de expiración del token (opcional, default: 7d)

# ============================================
# CONFIGURACIÓN DE SENDGRID (EMAIL)
# ============================================
SENDGRID_API_KEY=SG.tu_api_key_de_sendgrid_aqui
SENDGRID_FROM_EMAIL=noreply@tudominio.com
SENDGRID_FROM_NAME=Miru Franco Salón Beauty

# ============================================
# CONFIGURACIÓN DE GOOGLE OAUTH
# ============================================
GOOGLE_CLIENT_ID=tu_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu_google_client_secret

# ============================================
# CONFIGURACIÓN DE URLs
# ============================================
FRONTEND_URL=https://miru-franco.vercel.app
BACKEND_URL=https://miru-franco.onrender.com

# Para desarrollo local:
# FRONTEND_URL=http://localhost:3000
# BACKEND_URL=http://localhost:3001

# ============================================
# CONFIGURACIÓN DEL SERVIDOR
# ============================================
PORT=3001  # Puerto del servidor (opcional, default: 3000)
NODE_ENV=development  # development | production

# ============================================
# CONFIGURACIÓN ADICIONAL (Opcional)
# ============================================
# OTP_EXPIRES_IN=120000  # Tiempo de expiración del OTP en milisegundos (default: 120000 = 2 minutos)
# RESET_TOKEN_EXPIRES_IN=3600000  # Tiempo de expiración del token de recuperación (default: 1 hora)
```

### Configuración de CORS

El sistema está configurado para permitir solicitudes desde los siguientes orígenes:

**Producción:**
- `https://miru-franco.vercel.app`
- `https://miru-franco-pznm3jk0w-miru-franco.vercel.app`
- `https://miru-franco-4pdg1kua8-miru-franco.vercel.app`
- `https://miru-franco-hri9o928g-miru-franco.vercel.app`
- `https://miru-franco-idhk1rz7d-miru-franco.vercel.app`

**Desarrollo:**
- `http://localhost:3000`
- `http://localhost:3001`

**Configuración adicional:**
- `credentials: true` - Permite el envío de cookies
- Métodos permitidos: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`
- Headers permitidos: `Content-Type`, `Authorization`, `X-Requested-With`, `X-CSRF-Token`
- Headers expuestos: `Authorization`

### Headers de Seguridad HTTP

El sistema implementa los siguientes headers de seguridad:

```typescript
// Configuración en main.ts
app.use((req, res, next) => {
  // Previene MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Previene clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Protección básica contra XSS (legacy)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Fuerza HTTPS (solo en producción)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }
  
  // Previene XSS
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
  );
  
  // Controla información de referrer
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Limita funcionalidades del navegador
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()',
  );
  
  next();
});
```

### Configuración de TypeScript

El proyecto utiliza TypeScript con la siguiente configuración (`tsconfig.json`):

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Configuración de Prisma

El schema de Prisma define la estructura de la base de datos. Ver sección [Modelos de Datos](#modelos-de-datos) para más detalles.

**Comandos de Prisma:**
```bash
# Generar el cliente de Prisma
npm run prisma:generate

# Ejecutar migraciones
npm run prisma:migrate

# Abrir Prisma Studio (interfaz visual)
npm run prisma:studio
```

### Configuración de Validación Global

El sistema implementa validación global con las siguientes opciones:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,                    // Remueve propiedades no definidas en el DTO
    forbidNonWhitelisted: true,         // Rechaza propiedades no definidas
    transform: true,                     // Transforma automáticamente los tipos
    transformOptions: {
      enableImplicitConversion: true,   // Conversión implícita de tipos
    },
    disableErrorMessages: process.env.NODE_ENV === 'production', // Oculta mensajes detallados en producción
  }),
);
```

---

## Modelos de Datos

### Esquema de Base de Datos (Prisma)

El sistema utiliza PostgreSQL con Prisma como ORM. A continuación se detallan los modelos principales:

### Modelo: Usuario

```prisma
model Usuario {
  id                    String         @id @default(uuid())
  nombre                String
  email                 String         @unique
  telefono              String?
  password              String?
  fechaNacimiento       DateTime?
  googleId              String?        @unique
  foto                  String?
  aceptaAvisoPrivacidad Boolean        @default(false)
  recibePromociones     Boolean        @default(false)
  resetPasswordToken    String?
  resetPasswordExpires  DateTime?
  codigoOTP             String?
  otpExpira             DateTime?
  confirmado            Boolean        @default(false)
  creadoEn              DateTime       @default(now()) @map("creado_en")
  actualizadoEn         DateTime       @updatedAt @map("actualizado_en")
  activo                Boolean        @default(true)
  
  // Campos de seguridad
  intentosLoginFallidos Int            @default(0) @map("intentos_login_fallidos")
  cuentaBloqueadaHasta  DateTime?      @map("cuenta_bloqueada_hasta")
  ultimoIntentoLogin    DateTime?      @map("ultimo_intento_login")
  ultimaActividad       DateTime?      @map("ultima_actividad")
  tokensRevocadosDesde  DateTime?      @map("tokens_revocados_desde")
  rol                   String         @default("usuario") // 'usuario', 'admin'

  // Campos de dirección (embebidos)
  calle                 String?
  numero                String?
  colonia               String?
  ciudad                String?
  estado                String?
  codigoPostal          String?        @map("codigo_postal")

  // Campos de perfil capilar (embebidos)
  tipoCabello           TipoCabello?
  colorNatural          String?        @map("color_natural")
  colorActual           String?        @map("color_actual")
  productosUsados       String?        @map("productos_usados")
  alergias              String?

  // Campos de pregunta de seguridad (embebidos)
  preguntaSeguridad     String?        @map("pregunta_seguridad")
  respuestaSeguridad    String?        @map("respuesta_seguridad") // Hasheada con bcrypt

  @@index([activo])
  @@index([email])
  @@map("usuarios")
}
```

**Campos Principales:**
- `id`: Identificador único (UUID)
- `email`: Correo electrónico único
- `password`: Contraseña hasheada con bcrypt (opcional si usa Google OAuth)
- `googleId`: ID de Google para usuarios OAuth
- `rol`: Rol del usuario (`usuario` o `admin`)
- `confirmado`: Indica si el correo ha sido verificado
- `activo`: Indica si la cuenta está activa

**Campos de Seguridad:**
- `intentosLoginFallidos`: Contador de intentos fallidos
- `cuentaBloqueadaHasta`: Timestamp hasta cuando está bloqueada
- `ultimoIntentoLogin`: Último intento de login
- `ultimaActividad`: Última actividad del usuario
- `tokensRevocadosDesde`: Timestamp desde el cual todos los tokens anteriores están revocados

### Modelo: PreguntaDisponible

```prisma
model PreguntaDisponible {
  id        String   @id @default(uuid())
  pregunta  String   @unique
  activa    Boolean  @default(true)
  creadoEn  DateTime @default(now()) @map("creado_en")

  @@map("preguntas_disponibles")
}
```

### Modelo: TokenRevocado

```prisma
model TokenRevocado {
  id        String   @id @default(uuid())
  token     String   @unique
  expiraEn  DateTime @map("expira_en")
  creadoEn  DateTime @default(now()) @map("creado_en")

  @@index([expiraEn])
  @@map("tokens_revocados")
}
```

### Modelo: CodigoOAuth

```prisma
model CodigoOAuth {
  id        String   @id @default(uuid())
  codigo    String   @unique
  token     String   // Token JWT asociado
  expiraEn  DateTime @map("expira_en")
  usado     Boolean  @default(false)
  creadoEn  DateTime @default(now()) @map("creado_en")

  @@index([codigo])
  @@index([expiraEn])
  @@map("codigos_oauth")
}
```

### Enum: TipoCabello

```prisma
enum TipoCabello {
  liso
  ondulado
  rizado
}
```

---

## Autenticación y Autorización

### Autenticación JWT

El sistema utiliza JSON Web Tokens (JWT) para la autenticación. Los tokens se generan después de una verificación exitosa de OTP o autenticación OAuth.

#### Estructura del Token JWT

El token JWT contiene el siguiente payload:

```json
{
  "sub": "user_id",
  "email": "usuario@example.com",
  "rol": "usuario",
  "iat": 1234567890,
  "exp": 1234567890
}
```

#### Uso del Token

Incluir el token en el header `Authorization`:

```
Authorization: Bearer <token>
```

#### Expiración del Token

- **Tiempo de expiración por defecto:** 7 días
- **Configurable:** Mediante variable de entorno `JWT_EXPIRES_IN`

### Guards de Autenticación

El sistema implementa varios guards de NestJS:

#### JwtAuthGuard

Protege rutas que requieren autenticación. Verifica que el token JWT sea válido y no esté revocado.

**Uso:**
```typescript
@UseGuards(JwtAuthGuard)
@Get('protected')
protectedRoute() {
  return { message: 'Esta ruta está protegida' };
}
```

#### RolesGuard

Protege rutas que requieren un rol específico.

**Uso:**
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin-only')
adminRoute() {
  return { message: 'Solo para administradores' };
}
```

#### RateLimitGuard

Limita la cantidad de solicitudes por IP en un período de tiempo.

**Uso:**
```typescript
@UseGuards(new RateLimitGuard(5, 60000)) // 5 solicitudes por 60 segundos
@Post('login')
login() {
  // ...
}
```

### Decoradores Personalizados

#### @CurrentUser

Obtiene el usuario actual desde el request.

**Uso:**
```typescript
@Get('me')
@UseGuards(JwtAuthGuard)
getProfile(@CurrentUser() user: any) {
  return user;
}
```

### Flujo de Autenticación Completo

#### 1. Registro Tradicional

```
1. Usuario se registra → POST /api/usuarios/registrar
2. Sistema envía OTP por email
3. Usuario verifica OTP → POST /api/usuarios/verificar-otp
4. Sistema genera token JWT
5. Usuario puede acceder a rutas protegidas
```

#### 2. Login Tradicional

```
1. Usuario inicia sesión → POST /api/usuarios/login
2. Sistema valida credenciales
3. Sistema envía OTP por email
4. Usuario verifica OTP → POST /api/usuarios/verificar-otp
5. Sistema genera token JWT
6. Usuario puede acceder a rutas protegidas
```

#### 3. Google OAuth

```
1. Usuario hace clic en "Iniciar sesión con Google"
2. Frontend redirige a → GET /api/auth/google
3. Backend redirige a Google OAuth
4. Usuario autoriza en Google
5. Google redirige a → GET /api/auth/google/callback
6. Backend genera código temporal y redirige al frontend
7. Frontend intercambia código por token → POST /api/auth/exchange-code
8. Backend genera token JWT
9. Usuario puede acceder a rutas protegidas
```

### Revocación de Tokens

El sistema permite revocar tokens individuales o todos los tokens de un usuario:

#### Revocación Individual

```
POST /api/auth/logout
Authorization: Bearer <token>
Body: { "logoutAll": false }
```

#### Revocación Global

```
POST /api/auth/logout-all
Authorization: Bearer <token>
```

Esto actualiza el campo `tokensRevocadosDesde` del usuario, invalidando todos los tokens emitidos antes de esa fecha.

---

## Código de Ejemplo

### Integración Frontend con Fetch API

#### Configuración Base

```javascript
// config/api.js
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://miru-franco.onrender.com';

const apiRequest = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    credentials: 'include', // IMPORTANTE para CORS
  };

  const response = await fetch(`${API_BASE_URL}/api${endpoint}`, config);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Error en la solicitud');
  }
  
  return response.json();
};

export default apiRequest;
```

#### Ejemplo: Registro de Usuario

```javascript
// services/usuarioService.js
import apiRequest from '../config/api';

export const registrarUsuario = async (datosUsuario) => {
  return apiRequest('/usuarios/registrar', {
    method: 'POST',
    body: JSON.stringify({
      nombre: datosUsuario.nombre,
      email: datosUsuario.email,
      password: datosUsuario.password,
      aceptaAvisoPrivacidad: datosUsuario.aceptaAvisoPrivacidad,
      preguntaSeguridad: datosUsuario.preguntaSeguridad,
      respuestaSeguridad: datosUsuario.respuestaSeguridad,
    }),
  });
};
```

#### Ejemplo: Login y Verificación OTP

```javascript
// services/authService.js
import apiRequest from '../config/api';

export const login = async (email, password) => {
  return apiRequest('/usuarios/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
};

export const verificarOTP = async (email, codigo) => {
  const response = await apiRequest('/usuarios/verificar-otp', {
    method: 'POST',
    body: JSON.stringify({ email, codigo }),
  });
  
  if (response.success && response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  
  return response;
};

export const reenviarCodigo = async (email) => {
  return apiRequest('/usuarios/reenviar-codigo', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
};
```

#### Ejemplo: Obtener Perfil de Usuario

```javascript
export const obtenerPerfil = async () => {
  return apiRequest('/auth/me', {
    method: 'GET',
  });
};
```

#### Ejemplo: Google OAuth

```javascript
// services/googleAuthService.js
import apiRequest from '../config/api';

// Paso 1: Redirigir a Google OAuth
export const iniciarGoogleAuth = () => {
  window.location.href = `${API_BASE_URL}/api/auth/google`;
};

// Paso 2: Después del callback, intercambiar código por token
export const intercambiarCodigoPorToken = async (codigo) => {
  const response = await apiRequest('/auth/exchange-code', {
    method: 'POST',
    body: JSON.stringify({ code: codigo }),
  });
  
  if (response.success && response.data.token) {
    localStorage.setItem('token', response.data.token);
  }
  
  return response;
};
```

#### Ejemplo: React Hook para Autenticación

```javascript
// hooks/useAuth.js
import { useState, useEffect } from 'react';
import { obtenerPerfil, login, verificarOTP } from '../services/authService';

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cargarUsuario = async () => {
      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await obtenerPerfil();
          if (response.success) {
            setUser(response.data);
          }
        }
      } catch (err) {
        setError(err.message);
        localStorage.removeItem('token');
      } finally {
        setLoading(false);
      }
    };

    cargarUsuario();
  }, []);

  const iniciarSesion = async (email, password) => {
    try {
      setError(null);
      const response = await login(email, password);
      return response;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const verificarCodigo = async (email, codigo) => {
    try {
      setError(null);
      const response = await verificarOTP(email, codigo);
      if (response.success) {
        const profileResponse = await obtenerPerfil();
        if (profileResponse.success) {
          setUser(profileResponse.data);
        }
      }
      return response;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const cerrarSesion = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ logoutAll: false }),
        });
      }
      localStorage.removeItem('token');
      setUser(null);
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  return {
    user,
    loading,
    error,
    iniciarSesion,
    verificarCodigo,
    cerrarSesion,
  };
};
```

### Integración Frontend con Axios

#### Configuración de Axios

```javascript
// config/axios.js
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'https://miru-franco.onrender.com/api',
  withCredentials: true, // IMPORTANTE para CORS
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para agregar token a todas las solicitudes
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

// Interceptor para manejar errores de autenticación
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

#### Ejemplo de Uso con Axios

```javascript
// services/usuarioService.js
import api from '../config/axios';

export const registrarUsuario = (datosUsuario) => {
  return api.post('/usuarios/registrar', datosUsuario);
};

export const login = (email, password) => {
  return api.post('/usuarios/login', { email, password });
};

export const verificarOTP = (email, codigo) => {
  return api.post('/usuarios/verificar-otp', { email, codigo })
    .then((response) => {
      if (response.data.success && response.data.data.token) {
        localStorage.setItem('token', response.data.data.token);
      }
      return response.data;
    });
};

export const obtenerPerfil = () => {
  return api.get('/auth/me');
};
```

### Manejo de Errores

```javascript
// utils/errorHandler.js
export const manejarError = (error) => {
  if (error.response) {
    // El servidor respondió con un código de estado de error
    const { status, data } = error.response;
    
    switch (status) {
      case 400:
        return data.message || 'Solicitud inválida';
      case 401:
        return 'No autorizado. Por favor, inicia sesión.';
      case 403:
        return 'No tienes permisos para realizar esta acción.';
      case 404:
        return 'Recurso no encontrado.';
      case 429:
        return data.message || 'Demasiadas solicitudes. Intenta más tarde.';
      case 500:
        return 'Error del servidor. Por favor, intenta más tarde.';
      default:
        return data.message || 'Error desconocido';
    }
  } else if (error.request) {
    // La solicitud se hizo pero no se recibió respuesta
    return 'No se pudo conectar al servidor. Verifica tu conexión.';
  } else {
    // Algo pasó al configurar la solicitud
    return error.message || 'Error desconocido';
  }
};
```

---

## Guías de Implementación

### Configuración Inicial del Proyecto

#### 1. Requisitos Previos

- Node.js v18 o superior
- PostgreSQL (Neon recomendado para producción)
- Cuenta en SendGrid para envío de emails
- (Opcional) Cuenta de Google Cloud para OAuth

#### 2. Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/PerezMigue1/Backend-Miru-Franco.git
cd Backend-Miru-Franco

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 4. Generar Prisma Client
npm run prisma:generate

# 5. Ejecutar migraciones (si es necesario)
npm run prisma:migrate

# 6. Compilar el proyecto
npm run build

# 7. Iniciar en desarrollo
npm run start:dev
```

#### 3. Verificación de Instalación

1. Verificar que el servidor esté corriendo:
   ```
   GET http://localhost:3001/salud
   ```

2. Verificar información del API:
   ```
   GET http://localhost:3001/
   ```

### Configuración de Google OAuth

#### 1. Crear Proyecto en Google Cloud Console

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Crear un nuevo proyecto o seleccionar uno existente
3. Habilitar la API de Google+ o Google Identity

#### 2. Configurar OAuth Consent Screen

1. Ir a **APIs & Services** > **OAuth consent screen**
2. Seleccionar **External** (para desarrollo) o **Internal** (para organización)
3. Completar la información requerida:
   - App name: Miru Franco
   - User support email: tu email
   - Developer contact: tu email

#### 3. Crear Credenciales OAuth 2.0

1. Ir a **APIs & Services** > **Credentials**
2. Hacer clic en **Create Credentials** > **OAuth client ID**
3. Seleccionar **Web application**
4. Configurar:
   - Name: Miru Franco Backend
   - Authorized JavaScript origins:
     - `http://localhost:3001` (desarrollo)
     - `https://miru-franco.onrender.com` (producción)
   - Authorized redirect URIs:
     - `http://localhost:3001/api/auth/google/callback` (desarrollo)
     - `https://miru-franco.onrender.com/api/auth/google/callback` (producción)
5. Copiar **Client ID** y **Client Secret**

#### 4. Configurar Variables de Entorno

```env
GOOGLE_CLIENT_ID=tu_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu_client_secret
```

### Configuración de SendGrid

#### 1. Crear Cuenta en SendGrid

1. Registrarse en [SendGrid](https://sendgrid.com/)
2. Verificar tu cuenta de email

#### 2. Crear API Key

1. Ir a **Settings** > **API Keys**
2. Crear una nueva API Key con permisos de **Mail Send**
3. Copiar la API Key

#### 3. Configurar Variables de Entorno

```env
SENDGRID_API_KEY=SG.tu_api_key_aqui
SENDGRID_FROM_EMAIL=noreply@tudominio.com
SENDGRID_FROM_NAME=Miru Franco Salón Beauty
```

### Despliegue en Render

#### 1. Preparar el Proyecto

Asegúrate de que:
- El proyecto esté en un repositorio de GitHub
- Todas las variables de entorno estén documentadas
- El archivo `render.yaml` esté configurado

#### 2. Crear Servicio en Render

1. Iniciar sesión en [Render](https://render.com/)
2. Hacer clic en **New** > **Web Service**
3. Conectar tu repositorio de GitHub
4. Seleccionar el repositorio y la rama

#### 3. Configurar Build y Start

- **Environment:** Node
- **Build Command:** `npm install --include=dev && npm run build`
- **Start Command:** `node dist/main.js`

#### 4. Configurar Variables de Entorno

Agregar todas las variables de entorno necesarias en el dashboard de Render (ver sección [Variables de Entorno](#variables-de-entorno)).

#### 5. Configurar Health Check

- **Health Check Path:** `/salud`

#### 6. Desplegar

Hacer clic en **Create Web Service** y esperar a que se complete el despliegue.

### Pruebas de la API

#### Usando cURL

```bash
# Health check
curl http://localhost:3001/salud

# Registrar usuario
curl -X POST http://localhost:3001/api/usuarios/registrar \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Juan Pérez",
    "email": "juan@example.com",
    "password": "Password123!",
    "aceptaAvisoPrivacidad": true
  }'

# Login
curl -X POST http://localhost:3001/api/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "juan@example.com",
    "password": "Password123!"
  }'
```

#### Usando Postman

1. Crear una nueva colección
2. Configurar variable de entorno `base_url` = `http://localhost:3001`
3. Importar los endpoints necesarios
4. Configurar autenticación Bearer Token para rutas protegidas

### Troubleshooting Común

#### Error: "Cannot connect to database"

**Solución:**
- Verificar que `DATABASE_URL` esté correctamente configurada
- Verificar que la base de datos esté accesible
- Verificar que Prisma Client esté generado (`npm run prisma:generate`)

#### Error: "CORS policy: No 'Access-Control-Allow-Origin' header"

**Solución:**
- Verificar que el origen del frontend esté en la lista de orígenes permitidos
- Asegurarse de incluir `credentials: 'include'` en las solicitudes del frontend

#### Error: "JWT expired" o "Invalid token"

**Solución:**
- Verificar que el token no haya expirado
- Verificar que el token no haya sido revocado
- Generar un nuevo token mediante login o refresh

#### Error: "SendGrid API key is invalid"

**Solución:**
- Verificar que `SENDGRID_API_KEY` esté correctamente configurada
- Verificar que la API key tenga permisos de "Mail Send"
- Verificar que el email remitente esté verificado en SendGrid

---

## Recursos Adicionales

### Documentación Oficial

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [SendGrid Documentation](https://docs.sendgrid.com/)
- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)

### Enlaces Útiles

- Repositorio del proyecto: [GitHub](https://github.com/PerezMigue1/Backend-Miru-Franco)
- Documentación de CORS: Ver `CONFIGURACION_CORS_FRONTEND.md`
- Guía de verificación: Ver `GUIA_VERIFICACION_IMPLEMENTACION.md`

---

## Contacto y Soporte

Para preguntas o problemas relacionados con la implementación, por favor:

1. Revisar la documentación existente
2. Verificar los logs del servidor
3. Consultar los archivos de configuración
4. Contactar al equipo de desarrollo

---

**Última actualización:** Enero 2024  
**Versión de la API:** 1.0.0



