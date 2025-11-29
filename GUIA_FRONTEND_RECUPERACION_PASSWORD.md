# 🔐 Guía Frontend: Recuperación de Contraseña

## 📋 Resumen del Flujo

```
1. Usuario ingresa su email en pantalla "Olvidé mi contraseña"
2. Frontend llama a: POST /api/usuarios/pregunta-seguridad
3. Backend devuelve la pregunta específica del usuario (si existe)
4. Usuario responde la pregunta
5. Frontend llama a: POST /api/usuarios/verificar-respuesta
6. Backend devuelve un token temporal
7. Usuario ingresa nueva contraseña
8. Frontend llama a: POST /api/usuarios/cambiar-password
9. ✅ Contraseña actualizada
```

---

## ⚠️ IMPORTANTE: Dos Endpoints Diferentes

### ❌ NO uses este para recuperación:
```
GET /api/pregunta-seguridad
```
Este endpoint devuelve la **lista de preguntas disponibles** (para el formulario de registro).
- Se usa solo cuando el usuario se está **registrando**
- Devuelve todas las preguntas disponibles para elegir

### ✅ SÍ usa este para recuperación:
```
POST /api/usuarios/pregunta-seguridad
```
Este endpoint devuelve la **pregunta específica del usuario** que guardó al registrarse.
- Se usa cuando el usuario quiere **recuperar su contraseña**
- Devuelve solo la pregunta que ese usuario específico eligió

---

## 📡 Endpoints y Ejemplos de Código

### Paso 1: Obtener Pregunta de Seguridad del Usuario

**Endpoint:** `POST /api/usuarios/pregunta-seguridad`

**Ejemplo React/Next.js:**

```typescript
const obtenerPreguntaSeguridad = async (email: string) => {
  try {
    const response = await fetch(`${API_URL}/api/usuarios/pregunta-seguridad`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // ✅ Usuario tiene pregunta de seguridad
      return {
        success: true,
        pregunta: data.pregunta,
      };
    } else {
      // ❌ Usuario no tiene pregunta (puede ser usuario de Google)
      return {
        success: false,
        message: data.message || 'No se encontró pregunta de seguridad',
      };
    }
  } catch (error) {
    console.error('Error obteniendo pregunta:', error);
    return {
      success: false,
      message: 'Error al obtener la pregunta de seguridad',
    };
  }
};
```

**Response para usuario registrado (con pregunta):**
```json
{
  "success": true,
  "pregunta": "¿Cuál es el nombre de tu mascota favorita?"
}
```

**Response para usuario de Google (sin pregunta):**
```json
{
  "success": false,
  "statusCode": 404,
  "message": "Este correo está asociado a una cuenta de Google. No se puede usar recuperación de contraseña por pregunta de seguridad. Usa 'Continuar con Google' para iniciar sesión."
}
```

---

### Paso 2: Verificar Respuesta de Seguridad

**Endpoint:** `POST /api/usuarios/verificar-respuesta`

**Ejemplo React/Next.js:**

```typescript
const verificarRespuesta = async (email: string, respuesta: string) => {
  try {
    const response = await fetch(`${API_URL}/api/usuarios/verificar-respuesta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, respuesta }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // ✅ Respuesta correcta, recibimos token temporal
      return {
        success: true,
        token: data.token,
        email: data.email,
      };
    } else {
      // ❌ Respuesta incorrecta
      return {
        success: false,
        message: data.message || 'Respuesta incorrecta',
      };
    }
  } catch (error) {
    console.error('Error verificando respuesta:', error);
    return {
      success: false,
      message: 'Error al verificar la respuesta',
    };
  }
};
```

**Request Body:**
```json
{
  "email": "usuario@example.com",
  "respuesta": "Max"
}
```

**Response (éxito):**
```json
{
  "success": true,
  "token": "token-temporal-para-cambiar-password",
  "email": "usuario@example.com"
}
```

**Response (error):**
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Respuesta incorrecta"
}
```

---

### Paso 3: Cambiar Contraseña

**Endpoint:** `POST /api/usuarios/cambiar-password`

**Ejemplo React/Next.js:**

```typescript
const cambiarPassword = async (
  email: string,
  token: string,
  nuevaPassword: string,
) => {
  try {
    const response = await fetch(`${API_URL}/api/usuarios/cambiar-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        token,
        nuevaPassword,
      }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // ✅ Contraseña actualizada
      return {
        success: true,
        message: data.message || 'Contraseña actualizada correctamente',
      };
    } else {
      // ❌ Error al cambiar contraseña
      return {
        success: false,
        message: data.message || 'Error al cambiar la contraseña',
      };
    }
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    return {
      success: false,
      message: 'Error al cambiar la contraseña',
    };
  }
};
```

**Request Body:**
```json
{
  "email": "usuario@example.com",
  "token": "token-recibido-del-paso-anterior",
  "nuevaPassword": "nuevaContraseña123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Contraseña actualizada correctamente"
}
```

---

## 🎨 Ejemplo Completo: Componente React

```typescript
'use client'; // Si usas Next.js App Router

import { useState } from 'react';

const RecuperarPassword = () => {
  const [paso, setPaso] = useState<'email' | 'pregunta' | 'nuevaPassword'>('email');
  const [email, setEmail] = useState('');
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [token, setToken] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://miru-franco.onrender.com';

  const handleObtenerPregunta = async () => {
    if (!email) {
      setMensaje('Por favor ingresa tu email');
      return;
    }

    setLoading(true);
    setMensaje('');

    try {
      const response = await fetch(`${API_URL}/api/usuarios/pregunta-seguridad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // ✅ Usuario tiene pregunta
        setPregunta(data.pregunta);
        setPaso('pregunta');
        setMensaje('');
      } else {
        // ❌ Usuario no tiene pregunta (puede ser Google)
        setMensaje(data.message || 'No se encontró pregunta de seguridad');
      }
    } catch (error) {
      setMensaje('Error al obtener la pregunta. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerificarRespuesta = async () => {
    if (!respuesta.trim()) {
      setMensaje('Por favor ingresa tu respuesta');
      return;
    }

    setLoading(true);
    setMensaje('');

    try {
      const response = await fetch(`${API_URL}/api/usuarios/verificar-respuesta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, respuesta }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // ✅ Respuesta correcta
        setToken(data.token);
        setPaso('nuevaPassword');
        setMensaje('');
      } else {
        // ❌ Respuesta incorrecta
        setMensaje(data.message || 'Respuesta incorrecta. Intenta nuevamente.');
      }
    } catch (error) {
      setMensaje('Error al verificar la respuesta. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleCambiarPassword = async () => {
    if (!nuevaPassword || nuevaPassword.length < 6) {
      setMensaje('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setLoading(true);
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
        // ✅ Contraseña actualizada
        setMensaje('✅ Contraseña actualizada correctamente. Redirigiendo al login...');
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      } else {
        // ❌ Error
        setMensaje(data.message || 'Error al cambiar la contraseña');
      }
    } catch (error) {
      setMensaje('Error al cambiar la contraseña. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="recuperar-password-container">
      <h1>Recuperar Contraseña</h1>

      {paso === 'email' && (
        <div>
          <input
            type="email"
            placeholder="Ingresa tu email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
          <button onClick={handleObtenerPregunta} disabled={loading}>
            {loading ? 'Cargando...' : 'Continuar'}
          </button>
        </div>
      )}

      {paso === 'pregunta' && (
        <div>
          <p><strong>Pregunta de seguridad:</strong></p>
          <p>{pregunta}</p>
          <input
            type="text"
            placeholder="Tu respuesta"
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            disabled={loading}
          />
          <button onClick={handleVerificarRespuesta} disabled={loading}>
            {loading ? 'Verificando...' : 'Verificar Respuesta'}
          </button>
        </div>
      )}

      {paso === 'nuevaPassword' && (
        <div>
          <input
            type="password"
            placeholder="Nueva contraseña"
            value={nuevaPassword}
            onChange={(e) => setNuevaPassword(e.target.value)}
            disabled={loading}
          />
          <button onClick={handleCambiarPassword} disabled={loading}>
            {loading ? 'Actualizando...' : 'Cambiar Contraseña'}
          </button>
        </div>
      )}

      {mensaje && (
        <div className={`mensaje ${mensaje.includes('✅') ? 'exito' : 'error'}`}>
          {mensaje}
        </div>
      )}

      <button onClick={() => window.location.href = '/login'}>
        Volver al Login
      </button>
    </div>
  );
};

export default RecuperarPassword;
```

---

## 🔍 Manejo de Usuarios de Google

Si el usuario ingresó un email asociado a Google, el endpoint devolverá:

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Este correo está asociado a una cuenta de Google. No se puede usar recuperación de contraseña por pregunta de seguridad. Usa 'Continuar con Google' para iniciar sesión."
}
```

**Recomendación:** Mostrar este mensaje y ofrecer un botón para iniciar sesión con Google:

```typescript
if (mensaje.includes('cuenta de Google')) {
  return (
    <div>
      <p>{mensaje}</p>
      <button onClick={() => window.location.href = '/auth/google'}>
        Continuar con Google
      </button>
    </div>
  );
}
```

---

## ✅ Checklist de Implementación

- [ ] Usar `POST /api/usuarios/pregunta-seguridad` (NO `GET /api/pregunta-seguridad`)
- [ ] Manejar el caso de usuarios de Google (mostrar mensaje apropiado)
- [ ] Validar que el email no esté vacío antes de llamar al endpoint
- [ ] Validar que la respuesta no esté vacía
- [ ] Validar que la nueva contraseña tenga mínimo 6 caracteres
- [ ] Mostrar mensajes de error claros al usuario
- [ ] Manejar estados de carga (loading)
- [ ] Redirigir al login después de cambiar la contraseña exitosamente

---

## 🔗 URLs de los Endpoints

**Base URL (producción):**
```
https://miru-franco.onrender.com
```

**Base URL (desarrollo):**
```
http://localhost:3001
```

**Endpoints completos:**
- `POST /api/usuarios/pregunta-seguridad`
- `POST /api/usuarios/verificar-respuesta`
- `POST /api/usuarios/cambiar-password`

---

## 📝 Notas Importantes

1. **NO uses `GET /api/pregunta-seguridad` para recuperación** - Ese endpoint es solo para mostrar opciones en el formulario de registro.

2. **El token de verificación expira en 15 minutos** - Después de verificar la respuesta, el usuario tiene 15 minutos para cambiar la contraseña.

3. **Usuarios de Google no tienen pregunta de seguridad** - Deben usar "Continuar con Google" para iniciar sesión.

4. **Las respuestas son case-sensitive** - La respuesta debe coincidir exactamente (sin espacios al inicio/final).

5. **Validar en el frontend antes de enviar** - Mejora la experiencia del usuario y reduce llamadas innecesarias al backend.

