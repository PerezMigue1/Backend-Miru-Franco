# Backend Miru Franco - API REST

Backend API desarrollado con Node.js, Express, MongoDB para Miru Franco Beauty Salón. Incluye autenticación con JWT, verificación de email con OTP, OAuth con Google, y sistema de recuperación de contraseña.

## 📋 Descripción

API REST completa para gestión de usuarios del sistema Miru Franco Beauty Salón. Proporciona endpoints para registro, autenticación, verificación de correo electrónico mediante OTP, autenticación con Google OAuth, recuperación de contraseña mediante preguntas de seguridad, y gestión de perfiles de usuario.

## 🚀 Instalación Local

### Requisitos Previos

- Node.js (v14 o superior)
- MongoDB (Atlas o local)
- Cuenta en SendGrid para envío de emails
- (Opcional) Cuenta de Google Cloud para OAuth

### Pasos de Instalación

1. **Clonar el repositorio:**
```bash
git clone https://github.com/PerezMigue1/Backend-Miru-Franco.git
cd Backend-Miru-Franco
```

2. **Instalar las dependencias:**
```bash
npm install
```

3. **Configurar variables de entorno:**

Crea un archivo `.env` en la raíz del proyecto:

```env
# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database_name?retryWrites=true&w=majority

# JWT
JWT_SECRET=tu_secreto_jwt_aqui

# SendGrid
SENDGRID_API_KEY=SG.tu_api_key_aqui
SENDGRID_FROM_EMAIL=noreply@tudominio.com
SENDGRID_FROM_NAME=Miru Franco Salón Beauty

# URLs
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:3001

# Google OAuth (Opcional)
GOOGLE_CLIENT_ID=tu_client_id_aqui
GOOGLE_CLIENT_SECRET=tu_client_secret_aqui

# Sesiones
SESSION_SECRET=tu_session_secret_aqui
```

4. **Iniciar el servidor:**
```bash
# Modo desarrollo
npm run dev

# Modo producción
npm start
```

El servidor estará disponible en `http://localhost:3000`

## 🗄️ Configuración de MongoDB

### Opción 1: MongoDB Atlas (Recomendado)

1. Crea una cuenta en [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Crea un nuevo cluster (tier gratuito disponible)
3. Configura acceso de red (añade `0.0.0.0/0` para permitir conexiones desde cualquier lugar)
4. Crea un usuario de base de datos
5. Obtén tu connection string y actualiza `MONGODB_URI` en tu `.env`

### Opción 2: MongoDB Local

```bash
# Instalar MongoDB localmente
# Ver instrucciones en: https://www.mongodb.com/try/download/community

# Connection string local
MONGODB_URI=mongodb://localhost:27017/miru_db
```

## 🔐 Configuración de SendGrid

1. Crea una cuenta en [SendGrid](https://sendgrid.com/)
2. Verifica tu email remitente o dominio
3. Genera una API Key en Settings → API Keys
4. Agrega las variables `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` y `SENDGRID_FROM_NAME` a tu `.env`

**Importante:** Si usas un dominio sandbox, solo podrás enviar emails a direcciones autorizadas. Verifica tu email remitente en SendGrid para poder enviar a cualquier dirección.

## 🚀 Despliegue en Vercel

### Variables de Entorno en Vercel

Ve a tu proyecto en Vercel → Settings → Environment Variables y añade:

- `MONGODB_URI` - Connection string de MongoDB Atlas
- `JWT_SECRET` - Secreto para firmar tokens JWT
- `SENDGRID_API_KEY` - API Key de SendGrid
- `SENDGRID_FROM_EMAIL` - Email remitente verificado
- `SENDGRID_FROM_NAME` - Nombre del remitente
- `FRONTEND_URL` - URL del frontend
- `BACKEND_URL` - URL del backend (opcional)
- `GOOGLE_CLIENT_ID` - Client ID de Google OAuth (opcional)
- `GOOGLE_CLIENT_SECRET` - Client Secret de Google OAuth (opcional)
- `SESSION_SECRET` - Secreto para sesiones

### Desplegar

El proyecto se despliega automáticamente en Vercel al hacer push a la rama `main`.

## 📁 Estructura del Proyecto

```
backend-miru/
├── api/
│   └── index.js              # Punto de entrada para Vercel
├── config/
│   └── passport.js           # Configuración de Passport (Google OAuth)
├── controllers/
│   ├── userController.js     # Controladores de usuarios
│   └── preguntaSeguridadController.js
├── middleware/
│   ├── errorHandler.js       # Manejo de errores
│   └── notFound.js           # Manejo de rutas no encontradas
├── models/
│   ├── User.js               # Modelo de usuario
│   └── PreguntaSeguridad.js
├── routes/
│   ├── authRoutes.js         # Rutas de autenticación (Google OAuth, verificar correo)
│   ├── userRoutes.js         # Rutas de usuarios
│   └── preguntaSeguridadRoutes.js
├── utils/
│   └── sendEmail.js          # Servicio de email con SendGrid
├── server.js                 # Configuración del servidor Express
├── vercel.json               # Configuración de Vercel
└── package.json              # Dependencias
```

## 🔗 Endpoints de la API

### Base URL
- **Local:** `http://localhost:3000`
- **Producción:** `https://backend-miru-franco.vercel.app`

### Autenticación (`/api/auth`)

#### Google OAuth
- `GET /api/auth/google` - Iniciar autenticación con Google
- `GET /api/auth/google/callback` - Callback de Google OAuth
- `GET /api/auth/me` - Obtener información del usuario autenticado (requiere token JWT)
- `POST /api/auth/verificar-correo` - Verificar si un correo ya está registrado

**Ejemplo verificar correo:**
```bash
POST /api/auth/verificar-correo
Content-Type: application/json

{
  "correo": "usuario@ejemplo.com"
}

# Respuesta
{
  "existe": true,
  "message": "Este correo ya está registrado"
}
```

### Usuarios (`/api/usuarios`)

#### CRUD Básico
- `GET /api/usuarios` - Obtener todos los usuarios activos
- `GET /api/usuarios/:id` - Obtener usuario por ID
- `POST /api/usuarios` - Crear nuevo usuario (registro)
- `POST /api/usuarios/registrar` - Alias para registro
- `PUT /api/usuarios/:id` - Actualizar usuario
- `DELETE /api/usuarios/:id` - Eliminar usuario (soft delete)

#### Autenticación
- `POST /api/usuarios/login` - Iniciar sesión con email y contraseña

**Ejemplo login:**
```bash
POST /api/usuarios/login
Content-Type: application/json

{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123"
}
```

#### Verificación OTP
- `POST /api/usuarios/verificar-otp` - Verificar código OTP (activar cuenta)
- `POST /api/usuarios/reenviar-codigo` - Reenviar código OTP

**Ejemplo verificar OTP:**
```bash
POST /api/usuarios/verificar-otp
Content-Type: application/json

{
  "email": "usuario@ejemplo.com",
  "codigo": "123456"
}
```

**Ejemplo reenviar código:**
```bash
POST /api/usuarios/reenviar-codigo
Content-Type: application/json

{
  "email": "usuario@ejemplo.com"
}
```

#### Recuperación de Contraseña
- `POST /api/usuarios/pregunta-seguridad` - Obtener pregunta de seguridad
- `POST /api/usuarios/verificar-respuesta` - Verificar respuesta y obtener token
- `POST /api/usuarios/cambiar-password` - Cambiar contraseña con token

#### Perfil de Usuario
- `GET /api/usuarios/:id/perfil` - Obtener perfil de usuario
- `PUT /api/usuarios/:id/perfil` - Actualizar perfil de usuario
- `PUT /api/usuarios/:id/cambiar-password` - Cambiar contraseña desde perfil

### Preguntas de Seguridad (`/api/pregunta-seguridad`)
- Endpoints para gestión de preguntas de seguridad (ver archivo de rutas para más detalles)

## 🛠️ Tecnologías Utilizadas

- **Node.js** - Runtime de JavaScript
- **Express** - Framework web para Node.js
- **MongoDB** - Base de datos NoSQL
- **Mongoose** - ODM para MongoDB
- **JWT (jsonwebtoken)** - Autenticación mediante tokens
- **bcryptjs** - Hashing de contraseñas
- **Passport.js** - Middleware de autenticación
- **passport-google-oauth20** - Estrategia de autenticación con Google
- **SendGrid (@sendgrid/mail)** - Servicio de envío de emails
- **CORS** - Manejo de políticas de origen cruzado
- **Morgan** - Logger HTTP
- **dotenv** - Variables de entorno
- **express-session** - Manejo de sesiones

## 📝 Características Implementadas

### Autenticación y Seguridad
- ✅ Registro de usuarios con validación
- ✅ Login con email y contraseña
- ✅ Autenticación con Google OAuth
- ✅ Verificación de email mediante código OTP (6 dígitos, expira en 2 minutos)
- ✅ Reenvío de código OTP
- ✅ Recuperación de contraseña mediante preguntas de seguridad
- ✅ Cambio de contraseña desde perfil
- ✅ Verificación de correo existente en tiempo real
- ✅ JWT tokens para autenticación
- ✅ Hashing de contraseñas con bcrypt

### Gestión de Usuarios
- ✅ CRUD completo de usuarios
- ✅ Perfiles de usuario con información completa
- ✅ Soft delete de usuarios
- ✅ Usuarios de Google OAuth (campos opcionales)
- ✅ Validación de campos requeridos condicionales según tipo de usuario

### Email
- ✅ Envío de emails con SendGrid
- ✅ Emails de verificación OTP con diseño HTML
- ✅ Manejo de errores si el servicio de email no está disponible

## 🔐 Seguridad

- Las contraseñas se hashean con bcrypt antes de guardarse
- Las respuestas de preguntas de seguridad se hashean
- JWT tokens para autenticación sin estado
- Validación de datos con Mongoose
- Manejo seguro de errores sin exponer información sensible
- Variables de entorno para configuración sensible
- CORS configurado para APIs
- Índices en campos únicos para optimización

## 📊 Modelo de Usuario

El modelo de usuario incluye:

- Información personal: nombre, email, teléfono, fecha de nacimiento
- Autenticación: password (hasheado), googleId
- Verificación: códigoOTP, otpExpira, confirmado
- Seguridad: preguntaSeguridad (pregunta y respuesta hasheada)
- Recuperación: resetPasswordToken, resetPasswordExpires
- Perfil: dirección, perfilCapilar
- Preferencias: aceptaAvisoPrivacidad, recibePromociones
- Estado: activo, creadoEn, actualizadoEn

## 🔄 Flujo de Verificación OTP

1. Usuario se registra → Se genera código OTP de 6 dígitos
2. Código se envía por email (expira en 2 minutos)
3. Usuario ingresa código → Se verifica y activa cuenta (`confirmado: true`)
4. Usuario puede hacer login → Solo si `confirmado: true`
5. Si el código expira → Usuario puede solicitar uno nuevo

## 🔄 Flujo de Recuperación de Contraseña

1. Usuario solicita recuperación → Se obtiene pregunta de seguridad
2. Usuario responde pregunta → Se genera token temporal (15 minutos)
3. Usuario cambia contraseña → Con el token recibido

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

ISC

## 📞 Contacto

Para preguntas o soporte, contacta al equipo de desarrollo.

## 🔗 Enlaces Útiles

- [Documentación de Express](https://expressjs.com/)
- [Documentación de MongoDB](https://docs.mongodb.com/)
- [Documentación de SendGrid](https://docs.sendgrid.com/)
- [Documentación de Passport.js](https://www.passportjs.org/)
- [Documentación de Vercel](https://vercel.com/docs)
