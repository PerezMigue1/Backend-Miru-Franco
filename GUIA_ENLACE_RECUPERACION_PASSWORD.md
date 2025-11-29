# 🔐 Guía: Sistema de Enlace de Recuperación de Contraseña

Esta guía explica cómo funciona el sistema de recuperación de contraseña mediante enlace con token que se envía por email.

---

## 📋 Flujo Completo

```
1. Usuario solicita enlace de recuperación
   ↓
2. Backend genera token único y aleatorio
   ↓
3. Token se guarda en BD con fecha de expiración (60 minutos)
   ↓
4. Se envía email con enlace: https://tu-sitio.com/reset-password?token=XYZ&email=...
   ↓
5. Usuario hace clic en el enlace
   ↓
6. Frontend valida el token con el backend
   ↓
7. Usuario ingresa nueva contraseña
   ↓
8. Backend valida y actualiza contraseña
   ↓
9. Token se marca como usado (no puede reutilizarse)
```

---

## 🔧 Endpoints del Backend

### 1. Solicitar Enlace de Recuperación

**Endpoint:** `POST /api/usuarios/solicitar-enlace-recuperacion`

**Request:**
```json
{
  "email": "usuario@example.com"
}
```

**Response (éxito):**
```json
{
  "success": true,
  "message": "Si el email existe, recibirás un enlace de recuperación en tu correo."
}
```

**Características:**
- ✅ No revela si el email existe o no (prevenir enumeración)
- ✅ Genera token único de 32 bytes (64 caracteres hex)
- ✅ Token expira en 60 minutos (configurable con `RESET_TOKEN_EXPIRY_MINUTES`)
- ✅ Envía email con enlace de recuperación
- ✅ Rate limiting: 3 intentos por minuto por IP

---

### 2. Validar Token de Recuperación

**Endpoint:** `POST /api/usuarios/validar-token-recuperacion`

**Request:**
```json
{
  "email": "usuario@example.com",
  "token": "abc123def456..."
}
```

**Response (éxito):**
```json
{
  "success": true,
  "valid": true,
  "email": "usuario@example.com",
  "nombre": "Nombre del Usuario"
}
```

**Response (error):**
```json
{
  "statusCode": 400,
  "message": "Token inválido, expirado o ya utilizado"
}
```

**Cuándo usar:**
- Cuando el usuario hace clic en el enlace del email
- Para verificar que el token es válido antes de mostrar el formulario de nueva contraseña

---

### 3. Cambiar Contraseña con Token

**Endpoint:** `POST /api/usuarios/cambiar-password`

**Request:**
```json
{
  "email": "usuario@example.com",
  "token": "abc123def456...",
  "nuevaPassword": "NuevaPassword123!"
}
```

**Response (éxito):**
```json
{
  "success": true,
  "message": "Contraseña actualizada correctamente"
}
```

**Response (error - token usado):**
```json
{
  "statusCode": 400,
  "message": "Token inválido, expirado o ya utilizado"
}
```

**Response (error - misma contraseña):**
```json
{
  "statusCode": 400,
  "message": "La nueva contraseña no puede ser igual a la contraseña anterior"
}
```

**Características:**
- ✅ Valida que el token existe y no está expirado
- ✅ Valida que el token no ha sido usado antes
- ✅ Valida complejidad de contraseña
- ✅ Valida que no sea igual a la contraseña anterior
- ✅ Marca el token como usado después del primer uso
- ✅ No permite reutilizar el token

---

## 📧 Formato del Email

El email que se envía incluye:

- **Asunto:** "Recuperar Contraseña - Miru Franco"
- **Contenido:**
  - Mensaje de bienvenida
  - Botón grande para restablecer contraseña
  - Enlace alternativo (si el botón no funciona)
  - Advertencias:
    - El enlace expira en 60 minutos
    - Solo puede ser usado una vez
    - Si no lo solicitaste, ignorar el mensaje

**Ejemplo de enlace:**
```
https://miru-franco.vercel.app/reset-password?token=abc123def456...&email=usuario@example.com
```

---

## 🔒 Seguridad Implementada

### ✅ Prevención de Enumeración
- No revela si el email existe o no
- Siempre devuelve el mismo mensaje de éxito

### ✅ Token Seguro
- Token único de 32 bytes (64 caracteres hexadecimales)
- Generado con `crypto.randomBytes()` (criptográficamente seguro)
- Expira en 60 minutos (configurable)

### ✅ Uso Único
- Token se marca como `null` después del primer uso
- No puede reutilizarse
- Validación en cada paso

### ✅ Validación de Contraseña
- Mismo nivel de complejidad que el registro
- No puede ser igual a la contraseña anterior
- Validación de datos personales

### ✅ Rate Limiting
- 3 intentos por minuto por IP
- Previene spam y ataques de fuerza bruta

---

## 🎨 Implementación en el Frontend

### Paso 1: Solicitar Enlace

```typescript
const solicitarEnlaceRecuperacion = async (email: string) => {
  const response = await fetch(`${API_URL}/api/usuarios/solicitar-enlace-recuperacion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();
  return data;
};
```

### Paso 2: Validar Token (cuando el usuario hace clic en el enlace)

```typescript
const validarToken = async (email: string, token: string) => {
  const response = await fetch(`${API_URL}/api/usuarios/validar-token-recuperacion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token }),
  });

  if (!response.ok) {
    throw new Error('Token inválido o expirado');
  }

  const data = await response.json();
  return data;
};
```

### Paso 3: Cambiar Contraseña

```typescript
const cambiarPassword = async (email: string, token: string, nuevaPassword: string) => {
  const response = await fetch(`${API_URL}/api/usuarios/cambiar-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token, nuevaPassword }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.message || 'Error al cambiar la contraseña');
  }

  return data;
};
```

### Componente Completo: Página de Reset Password

```typescript
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom'; // o next/router si usas Next.js
import PasswordInput from '../components/PasswordInput';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');

  const [nuevaPassword, setNuevaPassword] = useState('');
  const [isPasswordValid, setIsPasswordValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [tokenValidado, setTokenValidado] = useState(false);

  // Validar token al cargar la página
  useEffect(() => {
    if (token && email) {
      validarToken(email, token);
    } else {
      setError('Enlace inválido. Falta el token o el email.');
    }
  }, [token, email]);

  const validarToken = async (email: string, token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/usuarios/validar-token-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.message || 'Token inválido o expirado');
        return;
      }

      const data = await response.json();
      setTokenValidado(true);
      setMensaje(`Hola ${data.nombre}, ingresa tu nueva contraseña.`);
    } catch (err) {
      setError('Error al validar el token. Intenta nuevamente.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordValid) {
      setError('Por favor corrige los errores en la contraseña');
      return;
    }

    if (isSubmitting) return;

    setIsSubmitting(true);
    setError('');
    setMensaje('');

    try {
      const response = await fetch(`${API_URL}/api/usuarios/cambiar-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          token,
          nuevaPassword,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMensaje('✅ Contraseña actualizada correctamente. Redirigiendo al login...');
        setTimeout(() => {
          window.location.href = '/login?passwordChanged=true';
        }, 2000);
      } else {
        setError(data.message || 'Error al cambiar la contraseña');
      }
    } catch (err) {
      setError('Error al conectar con el servidor');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token || !email) {
    return (
      <div className="reset-password-container">
        <div className="alert alert-danger">
          Enlace inválido. Falta el token o el email.
        </div>
      </div>
    );
  }

  if (!tokenValidado) {
    return (
      <div className="reset-password-container">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Validando token...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-password-container">
      <h2>Restablecer Contraseña</h2>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {mensaje && (
        <div className="alert alert-success" role="alert">
          {mensaje}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input
            type="email"
            className="form-control"
            value={email || ''}
            disabled
          />
        </div>

        <PasswordInput
          value={nuevaPassword}
          onChange={setNuevaPassword}
          onValidationChange={setIsPasswordValid}
          personalData={{ email }}
          label="Nueva Contraseña"
          placeholder="Ingresa tu nueva contraseña"
          showStrength={true}
          required={true}
        />

        <button
          type="submit"
          className="btn btn-primary w-100"
          disabled={isSubmitting || !isPasswordValid || !nuevaPassword}
        >
          {isSubmitting ? 'Cambiando contraseña...' : 'Cambiar Contraseña'}
        </button>
      </form>
    </div>
  );
}
```

---

## 🧪 Cómo Probar

### 1. Solicitar Enlace de Recuperación

```bash
POST https://miru-franco.onrender.com/api/usuarios/solicitar-enlace-recuperacion
Content-Type: application/json

{
  "email": "test@test.com"
}
```

**Resultado esperado:**
- Status 200
- Mensaje de éxito (siempre el mismo, no revela si el email existe)
- Email enviado al correo (si el email existe)

### 2. Revisar el Email

- Busca el email en la bandeja de entrada
- Copia el token del enlace: `?token=abc123...&email=test@test.com`

### 3. Validar Token

```bash
POST https://miru-franco.onrender.com/api/usuarios/validar-token-recuperacion
Content-Type: application/json

{
  "email": "test@test.com",
  "token": "abc123def456..."
}
```

**Resultado esperado:**
- Status 200
- `{ "success": true, "valid": true, "email": "...", "nombre": "..." }`

### 4. Cambiar Contraseña

```bash
POST https://miru-franco.onrender.com/api/usuarios/cambiar-password
Content-Type: application/json

{
  "email": "test@test.com",
  "token": "abc123def456...",
  "nuevaPassword": "NuevaPassword123!"
}
```

**Resultado esperado:**
- Status 200
- `{ "success": true, "message": "Contraseña actualizada correctamente" }`

### 5. Intentar Reutilizar el Token

```bash
POST https://miru-franco.onrender.com/api/usuarios/cambiar-password
Content-Type: application/json

{
  "email": "test@test.com",
  "token": "abc123def456...",  # Mismo token
  "nuevaPassword": "OtraPassword123!"
}
```

**Resultado esperado:**
- Status 400
- `{ "message": "Token inválido, expirado o ya utilizado" }`

### 6. Esperar 60+ Minutos y Probar

```bash
# Esperar más de 60 minutos
POST https://miru-franco.onrender.com/api/usuarios/validar-token-recuperacion
Content-Type: application/json

{
  "email": "test@test.com",
  "token": "abc123def456..."
}
```

**Resultado esperado:**
- Status 400
- `{ "message": "Token inválido, expirado o ya utilizado" }`

---

## ⚙️ Configuración

### Variable de Entorno

Puedes configurar el tiempo de expiración del token:

```env
# .env
RESET_TOKEN_EXPIRY_MINUTES=60  # Por defecto: 60 minutos
FRONTEND_URL=https://miru-franco.vercel.app
```

### Tiempos Recomendados

- **Mínimo:** 15 minutos (muy corto, puede ser molesto)
- **Recomendado:** 60 minutos (balance entre seguridad y usabilidad)
- **Máximo:** 24 horas (menos seguro)

---

## 📋 Checklist de Implementación

### Backend ✅ (Ya implementado)
- [x] Endpoint para solicitar enlace
- [x] Generación de token único
- [x] Guardado en BD con expiración
- [x] Envío de email con enlace
- [x] Endpoint para validar token
- [x] Endpoint para cambiar contraseña
- [x] Marcar token como usado
- [x] Prevenir reutilización
- [x] Validación de complejidad de contraseña
- [x] Prevenir enumeración de usuarios

### Frontend (Debes implementar)
- [ ] Página para solicitar enlace (`/forgot-password`)
- [ ] Página para resetear contraseña (`/reset-password`)
- [ ] Validar token al cargar la página
- [ ] Formulario de nueva contraseña con validaciones
- [ ] Manejo de errores (token expirado, usado, etc.)
- [ ] Redirección después de éxito

---

## 🔄 Comparación: Enlace vs Pregunta de Seguridad

| Característica | Enlace de Recuperación | Pregunta de Seguridad |
|----------------|------------------------|------------------------|
| **Método** | Email con enlace | Pregunta + respuesta |
| **Expiración** | 60 minutos | 10 minutos |
| **Uso** | Una vez | Una vez |
| **Ventaja** | Más seguro, no requiere recordar respuesta | Más rápido, no requiere email |
| **Endpoint solicitar** | `/solicitar-enlace-recuperacion` | `/pregunta-seguridad` |
| **Endpoint validar** | `/validar-token-recuperacion` | `/verificar-respuesta` |
| **Endpoint cambiar** | `/cambiar-password` | `/cambiar-password` |

**Ambos métodos están disponibles.** El usuario puede elegir cuál usar.

---

## 🎯 Resumen

✅ **Sistema completo implementado:**
- Generación de token único y seguro
- Guardado en BD con expiración (60 minutos)
- Envío de email con enlace
- Validación de token
- Cambio de contraseña con todas las validaciones
- Token de un solo uso
- Prevención de enumeración

¿Necesitas ayuda para implementar el frontend o probar el sistema?

