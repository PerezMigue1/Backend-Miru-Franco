# Variables de Entorno - Backend Miru Franco

Este documento lista todas las variables de entorno necesarias para ejecutar el backend localmente.

## 📋 Variables Requeridas

### 1. Base de Datos (Neon PostgreSQL)
```env
DATABASE_URL=postgresql://usuario:password@host.neon.tech/dbname?sslmode=require
```
- **Obligatoria**: ✅
- **Descripción**: URL de conexión a tu base de datos PostgreSQL en Neon
- **Cómo obtenerla**: En tu dashboard de Neon, ve a tu proyecto → Connection String

### 2. JWT Secret
```env
JWT_SECRET=tu_secreto_jwt_super_seguro_aqui
```
- **Obligatoria**: ✅
- **Descripción**: Secreto para firmar y verificar tokens JWT
- **Cómo generar**: 
  ```bash
  # En Linux/Mac:
  openssl rand -base64 32
  
  # O usa cualquier string largo y aleatorio
  ```

### 3. SendGrid (Email)
```env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@mirufranco.com
SENDGRID_FROM_NAME=Miru Franco Salón Beauty
```
- **Obligatorias**: `SENDGRID_API_KEY` y `SENDGRID_FROM_EMAIL` ✅
- **Opcional**: `SENDGRID_FROM_NAME` (default: "Miru Franco Salón Beauty")
- **Descripción**: Configuración para enviar emails (OTP, recuperación de contraseña)
- **Cómo obtener**:
  1. Crea cuenta en [SendGrid](https://sendgrid.com)
  2. Ve a Settings → API Keys → Create API Key
  3. Verifica tu dominio/email en Settings → Sender Authentication

### 4. Google OAuth
```env
GOOGLE_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
- **Obligatorias**: ✅ (si usas login con Google)
- **Descripción**: Credenciales para autenticación con Google
- **Cómo obtener**:
  1. Ve a [Google Cloud Console](https://console.cloud.google.com)
  2. Crea un proyecto o selecciona uno existente
  3. Ve a APIs & Services → Credentials
  4. Create Credentials → OAuth 2.0 Client ID
  5. Configura Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`

### 5. Frontend URL
```env
FRONTEND_URL=http://localhost:3000
```
- **Obligatoria**: ✅
- **Descripción**: URL del frontend (para CORS y enlaces en emails)
- **Valores comunes**:
  - Desarrollo: `http://localhost:3000`
  - Producción: `https://miru-franco.vercel.app`

## 🔧 Variables Opcionales

### Puerto del Servidor
```env
PORT=3000
```
- **Default**: `3000`
- **Descripción**: Puerto donde correrá el servidor

### Entorno
```env
NODE_ENV=development
```
- **Default**: `development`
- **Valores**: `development` | `production`
- **Descripción**: Modo de ejecución (afecta headers de seguridad, mensajes de error, etc.)

### Expiración de Token de Recuperación
```env
RESET_TOKEN_EXPIRY_MINUTES=10
```
- **Default**: `10`
- **Descripción**: Minutos de validez del token de recuperación de contraseña

### Cloudinary (imágenes)
Las variables de Cloudinary **no van en el backend** si subes las imágenes desde el frontend. Van en el **.env del frontend**. Ver [CLOUDINARY.md](./CLOUDINARY.md) para detalles.

## 📝 Archivo .env Local

Crea un archivo `.env` en la raíz del proyecto con estas variables:

```env
# Base de datos
DATABASE_URL=postgresql://usuario:password@host.neon.tech/dbname?sslmode=require

# JWT
JWT_SECRET=tu_secreto_jwt_super_seguro_aqui

# SendGrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@mirufranco.com
SENDGRID_FROM_NAME=Miru Franco Salón Beauty

# Google OAuth
GOOGLE_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Frontend
FRONTEND_URL=http://localhost:3000

# Servidor (opcional)
PORT=3000
NODE_ENV=development
RESET_TOKEN_EXPIRY_MINUTES=10

# Cloudinary: solo si subes imágenes desde el backend (ver CLOUDINARY.md)
# CLOUDINARY_CLOUD_NAME=tu_cloud_name
# CLOUDINARY_API_KEY=tu_api_key
# CLOUDINARY_API_SECRET=tu_api_secret
```

## 🚀 Comandos para Ejecutar

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Generar cliente Prisma**:
   ```bash
   npm run prisma:generate
   ```

3. **Ejecutar migraciones** (si es necesario):
   ```bash
   npm run prisma:migrate
   ```

4. **Iniciar servidor en desarrollo**:
   ```bash
   npm run start:dev
   ```

5. **Iniciar servidor en producción**:
   ```bash
   npm run build
   npm run start:prod
   ```

## ⚠️ Notas Importantes

- **Nunca subas el archivo `.env` a Git** (debe estar en `.gitignore`)
- **Usa valores diferentes** para `JWT_SECRET` en desarrollo y producción
- **Verifica tu email/dominio en SendGrid** antes de usar el servicio de emails
- **Configura correctamente los redirect URIs** en Google OAuth para evitar errores

