# Backend Miru Franco - API REST

Backend API desarrollado con **NestJS**, **TypeScript** y **Prisma** para Miru Franco Beauty Salón. Incluye autenticación con JWT, verificación de email con OTP, OAuth con Google, y sistema de recuperación de contraseña.

## 📋 Descripción

API REST completa para gestión de usuarios del sistema Miru Franco Beauty Salón. Proporciona endpoints para registro, autenticación, verificación de correo electrónico mediante OTP, autenticación con Google OAuth, recuperación de contraseña mediante preguntas de seguridad, y gestión de perfiles de usuario.

## 🛠️ Tecnologías

- **Framework**: NestJS
- **Lenguaje**: TypeScript
- **ORM**: Prisma
- **Base de Datos**: PostgreSQL (Neon)
- **Autenticación**: JWT, Passport.js (Google OAuth)
- **Email**: SendGrid
- **Deployment**: Render

## 🚀 Instalación Local

### Requisitos Previos

- Node.js (v18 o superior)
- PostgreSQL (Neon o local)
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
# PostgreSQL (Neon)
DATABASE_URL=postgresql://username:password@host/database?sslmode=require

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
GOOGLE_CLIENT_ID=tu_google_client_id
GOOGLE_CLIENT_SECRET=tu_google_client_secret

# Puerto (opcional, por defecto 3000)
PORT=3001
```

4. **Generar Prisma Client:**
```bash
npm run prisma:generate
```

5. **Compilar el proyecto:**
```bash
npm run build
```

6. **Ejecutar en modo desarrollo:**
```bash
npm run start:dev
```

7. **Ejecutar en producción:**
```bash
npm run start:prod
```

## 🚀 Despliegue en Render

### Configuración en Render

1. **Crear un nuevo Web Service en Render:**
   - Conectar tu repositorio de GitHub
   - Seleccionar la rama principal

2. **Configurar el Build:**
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`
   - **Environment**: `Node`

3. **Variables de Entorno:**
   Configura las siguientes variables de entorno en el dashboard de Render:
   
   ```
   NODE_ENV=production
   PORT=10000
   DATABASE_URL=tu_connection_string_postgresql
   JWT_SECRET=tu_secreto_jwt
   SENDGRID_API_KEY=tu_api_key
   SENDGRID_FROM_EMAIL=tu_email
   SENDGRID_FROM_NAME=Miru Franco Salón Beauty
   GOOGLE_CLIENT_ID=tu_client_id
   GOOGLE_CLIENT_SECRET=tu_client_secret
   BACKEND_URL=https://tu-app.onrender.com
   FRONTEND_URL=https://tu-frontend.com
   ```

4. **Opción con render.yaml:**
   El proyecto incluye un archivo `render.yaml` que puedes usar para configurar el servicio. Render detectará automáticamente este archivo.

### Importante para Render

- Render asigna un puerto dinámico, pero puedes usar `PORT=10000` en las variables de entorno
- El comando de build incluye `prisma generate` para generar el cliente de Prisma
- Asegúrate de que todas las variables de entorno estén configuradas antes del primer despliegue

## 📚 Estructura del Proyecto

```
backend-miru/
├── src/
│   ├── main.ts                 # Punto de entrada
│   ├── app.module.ts           # Módulo principal
│   ├── prisma/
│   │   ├── prisma.service.ts   # Servicio de Prisma
│   │   └── prisma.module.ts    # Módulo de Prisma
│   ├── usuarios/
│   │   ├── usuarios.module.ts
│   │   ├── usuarios.service.ts
│   │   ├── usuarios.controller.ts
│   │   └── dto/                # Data Transfer Objects
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   └── strategies/         # Estrategias de Passport
│   └── email/
│       ├── email.module.ts
│       └── email.service.ts    # Servicio de SendGrid
├── prisma/
│   └── schema.prisma           # Schema de Prisma
├── render.yaml                 # Configuración de Render
├── tsconfig.json               # Configuración de TypeScript
├── nest-cli.json               # Configuración de NestJS CLI
└── package.json
```

## 🔌 Endpoints Principales

### Usuarios

- `POST /api/usuarios/registrar` - Registrar nuevo usuario
- `POST /api/usuarios/login` - Iniciar sesión
- `GET /api/usuarios` - Obtener todos los usuarios (requiere autenticación)
- `GET /api/usuarios/:id` - Obtener usuario por ID

### Verificación OTP

- `POST /api/usuarios/verificar-otp` - Verificar código OTP
- `POST /api/usuarios/reenviar-codigo` - Reenviar código OTP

### Autenticación

- `GET /api/auth/google` - Iniciar autenticación con Google
- `GET /api/auth/google/callback` - Callback de Google OAuth
- `POST /api/auth/verificar-correo` - Verificar si un correo existe
- `GET /api/auth/me` - Obtener perfil del usuario autenticado

## 🔒 Autenticación

El proyecto utiliza JWT (JSON Web Tokens) para la autenticación. Los tokens se envían en el header `Authorization`:

```
Authorization: Bearer <token>
```

## 📧 Verificación de Email

El sistema utiliza SendGrid para enviar códigos OTP de 6 dígitos por email. Los códigos expiran en 2 minutos.

## 🔐 OAuth con Google

Los usuarios pueden registrarse e iniciar sesión usando su cuenta de Google. Los usuarios autenticados con Google se marcan automáticamente como confirmados.

## 🧪 Scripts Disponibles

- `npm run build` - Compilar el proyecto
- `npm run start` - Iniciar en producción
- `npm run start:dev` - Iniciar en modo desarrollo con hot-reload
- `npm run start:prod` - Iniciar en producción (compilado)
- `npm run prisma:generate` - Generar Prisma Client
- `npm run prisma:migrate` - Ejecutar migraciones
- `npm run prisma:studio` - Abrir Prisma Studio

## 📝 Notas

- El prefijo global de todas las rutas es `/api`
- La base de datos utiliza MongoDB con Prisma como ORM
- Los campos embebidos (`preguntaSeguridad`, `direccion`, `perfilCapilar`) se almacenan como JSON en MongoDB
- Las contraseñas y respuestas de seguridad se hashean con bcrypt

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia ISC.
