# 🔐 Guía: Autenticación con Google OAuth

## 📋 ¿Cómo Funciona Google OAuth?

El flujo OAuth de Google funciona así:

```
1. Usuario hace clic en "Continuar con Google" (Frontend)
   ↓
2. Frontend redirige a: /api/auth/google (Backend)
   ↓
3. Backend redirige a Google OAuth (Google)
   ↓
4. Usuario autoriza en Google
   ↓
5. Google redirige de vuelta a: /api/auth/google/callback (Backend)
   ↓
6. Backend obtiene datos del usuario de Google
   ↓
7. Backend crea/actualiza usuario en tu base de datos
   ↓
8. Backend redirige a Frontend con token JWT
   ↓
9. Frontend guarda token y autentica al usuario
```

---

## 🔧 Paso 1: Configurar Google Cloud Console

### 1.1. Crear un Proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. Navega a **APIs & Services** > **Credentials**

### 1.2. Configurar OAuth Consent Screen

1. Ve a **OAuth consent screen**
2. Selecciona **External** (para usuarios externos)
3. Completa:
   - **App name**: Miru Franco
   - **User support email**: Tu email
   - **Developer contact information**: Tu email
   - **Scopes**: Agrega `email` y `profile`
4. Guarda y continúa

### 1.3. Crear Credentials OAuth 2.0

1. Ve a **Credentials** > **Create Credentials** > **OAuth client ID**
2. Selecciona **Web application**
3. Configura:

   **Authorized JavaScript origins:**
   ```
   http://localhost:3000          (desarrollo local)
   https://tu-dominio.com        (producción)
   https://miru-franco.vercel.app (si usas Vercel)
   ```

   **Authorized redirect URIs:**
   ```
   http://localhost:3001/api/auth/google/callback   (backend local)
   https://backend-miru-franco.vercel.app/api/auth/google/callback  (backend producción)
   ```

4. Guarda y **copia**:
   - **Client ID** (ej: `123456789-abc.apps.googleusercontent.com`)
   - **Client Secret** (ej: `GOCSPX-xxxxxxx`)

---

## 🔧 Paso 2: Configurar Variables de Entorno

### En tu Backend (Node.js/Express):

Crea o actualiza `.env` en tu proyecto backend:

```env
# Google OAuth
GOOGLE_CLIENT_ID=tu-client-id-aqui.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu-client-secret-aqui

# URLs
FRONTEND_URL=http://localhost:3000          # Desarrollo
# FRONTEND_URL=https://miru-franco.vercel.app  # Producción
BACKEND_URL=http://localhost:3001          # Desarrollo
# BACKEND_URL=https://backend-miru-franco.vercel.app  # Producción
```

### En tu Frontend (Next.js):

El frontend no necesita configurar nada especial, ya usa `NEXT_PUBLIC_API_URL`.

---

## 💻 Paso 3: Implementar en el Backend (Node.js/Express)

### 3.1. Instalar dependencias necesarias:

```bash
npm install passport passport-google-oauth20 express-session
npm install --save-dev @types/passport @types/passport-google-oauth20
```

### 3.2. Ejemplo de implementación del backend:

```javascript
// backend/routes/auth.js o backend/routes/auth.ts

const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const router = express.Router();

// Configurar Passport con Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/api/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Buscar o crear usuario en tu base de datos
      let user = await User.findOne({ email: profile.emails[0].value });
      
      if (!user) {
        // Crear nuevo usuario
        user = await User.create({
          nombre: profile.displayName,
          email: profile.emails[0].value,
          googleId: profile.id,
          foto: profile.photos[0].value,
          // Otros campos que necesites
        });
      } else {
        // Actualizar Google ID si no existe
        if (!user.googleId) {
          user.googleId = profile.id;
          await user.save();
        }
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Serializar usuario para la sesión
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Ruta para iniciar autenticación con Google
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Callback de Google OAuth
router.get('/google/callback',
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      const user = req.user;
      
      // Generar token JWT (como lo haces en login normal)
      const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      // Redirigir al frontend con el token
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?token=${token}&success=true`);
      
    } catch (error) {
      console.error('Error en callback de Google:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?error=authentication_failed`);
    }
  }
);

module.exports = router;
```

### 3.3. Configurar Passport en tu app principal:

```javascript
// backend/app.js o backend/index.js

const express = require('express');
const session = require('express-session');
const passport = require('passport');

const app = express();

// Configurar sesiones (necesario para Passport)
app.use(session({
  secret: process.env.SESSION_SECRET || 'tu-secret-key',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Rutas de autenticación
app.use('/api/auth', require('./routes/auth'));
```

---

## 🎨 Paso 4: Manejar Callback en el Frontend

El backend redirige de vuelta con el token. Necesitas crear una página para manejarlo:

### Crear `src/app/auth/callback/page.tsx`:

```typescript
'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function AuthCallback() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = searchParams.get('token');
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (success === 'true' && token) {
      // Guardar token
      localStorage.setItem('token', token);
      
      // Redirigir a la página principal o dashboard
      router.push('/home');
    } else if (error) {
      // Manejar error
      console.error('Error en autenticación:', error);
      router.push('/?error=google_auth_failed');
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-fondo-general">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-menu-texto-principal mx-auto mb-4"></div>
        <p className="text-texto-fondo-oscuro">Autenticando...</p>
      </div>
    </div>
  );
}
```

---

## ✅ Paso 5: Verificar que Todo Funciona

### 5.1. Flujo Completo:

1. **Usuario hace clic en "Continuar con Google"**
   - Frontend redirige a: `http://tu-backend.com/api/auth/google`

2. **Backend redirige a Google**
   - Google muestra pantalla de autorización

3. **Usuario autoriza**
   - Google redirige a: `http://tu-backend.com/api/auth/google/callback`

4. **Backend procesa y redirige**
   - Backend crea/actualiza usuario
   - Genera token JWT
   - Redirige a: `http://tu-frontend.com/auth/callback?token=xxx&success=true`

5. **Frontend guarda token**
   - Página de callback guarda token en localStorage
   - Redirige a `/home` o página principal

---

## 🔍 Solución de Problemas

### Error: "redirect_uri_mismatch"
- **Problema**: La URI de redirección no coincide
- **Solución**: Verifica que la URI en Google Cloud Console sea exactamente igual a la del código

### Error: "invalid_client"
- **Problema**: Client ID o Secret incorrectos
- **Solución**: Verifica las variables de entorno `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`

### El botón no redirige
- **Problema**: Backend no está corriendo o URL incorrecta
- **Solución**: Verifica `NEXT_PUBLIC_API_URL` y que el backend esté corriendo

### Token no se guarda
- **Problema**: Página de callback no existe o no maneja el token
- **Solución**: Crea la página `/auth/callback` como se muestra arriba

---

## 📝 Resumen de URLs Necesarias

### En Google Cloud Console:
```
Authorized JavaScript origins:
- http://localhost:3000
- https://miru-franco.vercel.app

Authorized redirect URIs:
- http://localhost:3001/api/auth/google/callback
- https://backend-miru-franco.vercel.app/api/auth/google/callback
```

### En el Código:
```
Frontend redirige a: BACKEND_BASE/api/auth/google
Google redirige a: BACKEND_BASE/api/auth/google/callback
Backend redirige a: FRONTEND_URL/auth/callback?token=xxx
```

---

## 🚀 Listo para Probar

Una vez configurado todo:

1. Inicia tu backend
2. Inicia tu frontend
3. Haz clic en "Continuar con Google"
4. Deberías ser redirigido a Google para autorizar
5. Después de autorizar, vuelves a tu app autenticado

---

¿Necesitas ayuda con algún paso específico?

