# 🔄 Guía: Actualizar Frontend para Rate Limiting de Recuperación de Contraseña

## 📋 Resumen de Cambios en el Backend

El backend ahora implementa **rate limiting** en los endpoints de recuperación de contraseña:

1. **Recuperación por código OTP**: `POST /api/usuarios/reenviar-codigo`
   - Límite: **3 intentos por minuto por IP**
   
2. **Recuperación por enlace**: `POST /api/usuarios/solicitar-enlace-recuperacion`
   - Límite: **3 intentos por minuto por IP**

3. **Pregunta de seguridad**: `POST /api/usuarios/pregunta-seguridad`
   - Límite: **3 intentos por minuto por IP**

## ⚠️ Respuesta del Backend cuando se excede el límite

Cuando un usuario intenta más de 3 veces en un minuto, el backend devuelve:

**Código de estado:** `429 Too Many Requests`

**Cuerpo de la respuesta:**
```json
{
  "success": false,
  "message": "Demasiadas solicitudes. Intenta de nuevo en X segundos.",
  "retryAfter": 60
}
```

## 🔧 Cambios Necesarios en el Frontend

### 1. Manejo de Error 429 en Recuperación por Código OTP

**Ubicación:** Componente de "Reenviar código OTP" o "Recuperar contraseña con OTP"

#### Ejemplo con React/Next.js:

```jsx
import { useState } from 'react';

export default function ReenviarCodigoOTP() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Contador regresivo
  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setCountdown(null);
      setRetryAfter(null);
      setError('');
    }
  }, [countdown]);

  const handleReenviarCodigo = async (e) => {
    e.preventDefault();
    
    setError('');
    setLoading(true);
    setRetryAfter(null);
    setCountdown(null);

    try {
      const response = await fetch('https://miru-franco.onrender.com/api/usuarios/reenviar-codigo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        // ✅ Manejar error 429 (Rate Limiting)
        if (response.status === 429) {
          const retrySeconds = data.retryAfter || 60;
          setRetryAfter(retrySeconds);
          setCountdown(retrySeconds);
          setError(`Demasiados intentos. Espera ${retrySeconds} segundos antes de intentar nuevamente.`);
          return;
        }
        
        // Otros errores
        setError(data.message || 'Error al reenviar el código');
        return;
      }

      // ✅ Éxito
      setError('');
      alert('Código reenviado. Revisa tu correo electrónico.');
      
    } catch (err) {
      setError('Error de conexión. Verifica tu internet e intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleReenviarCodigo}>
      <div>
        <label>Email:</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading || countdown !== null}
        />
      </div>

      {/* ✅ Mostrar error con contador regresivo */}
      {error && (
        <div style={{ 
          color: 'red', 
          padding: '10px',
          backgroundColor: '#ffe6e6',
          borderRadius: '4px',
          margin: '10px 0'
        }}>
          {error}
          {countdown !== null && (
            <div style={{ marginTop: '5px', fontSize: '14px' }}>
              ⏱️ Puedes intentar nuevamente en: <strong>{countdown}</strong> segundos
            </div>
          )}
        </div>
      )}

      <button 
        type="submit" 
        disabled={loading || countdown !== null}
      >
        {loading 
          ? 'Enviando...' 
          : countdown !== null 
            ? `Espera ${countdown}s` 
            : 'Reenviar código'
        }
      </button>
    </form>
  );
}
```

### 2. Manejo de Error 429 en Recuperación por Enlace

**Ubicación:** Componente de "Solicitar enlace de recuperación"

#### Ejemplo con React/Next.js:

```jsx
import { useState, useEffect } from 'react';

export default function SolicitarEnlaceRecuperacion() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Contador regresivo
  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setCountdown(null);
      setRetryAfter(null);
      setError('');
    }
  }, [countdown]);

  const handleSolicitarEnlace = async (e) => {
    e.preventDefault();
    
    setError('');
    setSuccess(false);
    setLoading(true);
    setRetryAfter(null);
    setCountdown(null);

    try {
      const response = await fetch('https://miru-franco.onrender.com/api/usuarios/solicitar-enlace-recuperacion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        // ✅ Manejar error 429 (Rate Limiting)
        if (response.status === 429) {
          const retrySeconds = data.retryAfter || 60;
          setRetryAfter(retrySeconds);
          setCountdown(retrySeconds);
          setError(`Demasiados intentos. Espera ${retrySeconds} segundos antes de intentar nuevamente.`);
          return;
        }
        
        // Otros errores
        setError(data.message || 'Error al solicitar el enlace de recuperación');
        return;
      }

      // ✅ Éxito
      setSuccess(true);
      setError('');
      setEmail(''); // Opcional: limpiar el campo después del éxito
      
    } catch (err) {
      setError('Error de conexión. Verifica tu internet e intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSolicitarEnlace}>
      <div>
        <label>Email:</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading || countdown !== null}
        />
      </div>

      {/* ✅ Mostrar mensaje de éxito */}
      {success && (
        <div style={{ 
          color: 'green', 
          padding: '10px',
          backgroundColor: '#e6ffe6',
          borderRadius: '4px',
          margin: '10px 0'
        }}>
          ✅ Si el email existe, se ha enviado un enlace de recuperación. Revisa tu correo electrónico.
        </div>
      )}

      {/* ✅ Mostrar error con contador regresivo */}
      {error && (
        <div style={{ 
          color: 'red', 
          padding: '10px',
          backgroundColor: '#ffe6e6',
          borderRadius: '4px',
          margin: '10px 0'
        }}>
          {error}
          {countdown !== null && (
            <div style={{ marginTop: '5px', fontSize: '14px' }}>
              ⏱️ Puedes intentar nuevamente en: <strong>{countdown}</strong> segundos
            </div>
          )}
        </div>
      )}

      <button 
        type="submit" 
        disabled={loading || countdown !== null || success}
      >
        {loading 
          ? 'Enviando...' 
          : countdown !== null 
            ? `Espera ${countdown}s` 
            : success
              ? 'Enlace enviado'
              : 'Solicitar enlace de recuperación'
        }
      </button>
    </form>
  );
}
```

### 3. Ejemplo con Axios (Alternativa)

Si usas Axios en lugar de fetch:

```jsx
import axios from 'axios';
import { useState, useEffect } from 'react';

export default function SolicitarEnlaceRecuperacion() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setCountdown(null);
      setError('');
    }
  }, [countdown]);

  const handleSolicitarEnlace = async (e) => {
    e.preventDefault();
    
    setError('');
    setLoading(true);
    setCountdown(null);

    try {
      const response = await axios.post(
        'https://miru-franco.onrender.com/api/usuarios/solicitar-enlace-recuperacion',
        { email }
      );
      
      // ✅ Éxito
      alert('Enlace enviado. Revisa tu correo electrónico.');
      
    } catch (error) {
      // ✅ Manejar error 429 (Rate Limiting)
      if (error.response?.status === 429) {
        const retrySeconds = error.response.data?.retryAfter || 60;
        setCountdown(retrySeconds);
        setError(`Demasiados intentos. Espera ${retrySeconds} segundos.`);
      } else {
        setError(error.response?.data?.message || 'Error al solicitar el enlace');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSolicitarEnlace}>
      {/* ... campos del formulario ... */}
      
      {error && (
        <div style={{ color: 'red' }}>
          {error}
          {countdown !== null && (
            <div>⏱️ Espera {countdown} segundos</div>
          )}
        </div>
      )}
      
      <button 
        type="submit" 
        disabled={loading || countdown !== null}
      >
        {countdown !== null ? `Espera ${countdown}s` : 'Solicitar enlace'}
      </button>
    </form>
  );
}
```

## 📝 Checklist de Implementación

### Para el Frontend:

- [ ] **Manejar error 429** en el componente de reenvío de código OTP
- [ ] **Manejar error 429** en el componente de solicitud de enlace de recuperación
- [ ] **Mostrar contador regresivo** cuando se excede el límite
- [ ] **Deshabilitar el botón** durante el tiempo de espera
- [ ] **Mostrar mensaje claro** al usuario sobre el límite de intentos
- [ ] **Mantener el email** en el campo (no borrarlo después de error 429)
- [ ] **Probar con 4+ intentos rápidos** para verificar que funciona

### Mejoras Opcionales (UX):

- [ ] Mostrar un spinner o indicador visual durante la espera
- [ ] Usar un componente de "Progress Bar" para el contador
- [ ] Guardar el tiempo de espera en localStorage (para persistir entre recargas)
- [ ] Mostrar un tooltip explicando por qué está limitado

## 🧪 Cómo Probar

### Prueba 1: Rate Limiting de Reenvío de Código OTP

1. Abre tu aplicación frontend
2. Ve a la pantalla de "Reenviar código OTP"
3. Ingresa un email válido
4. Haz clic en "Reenviar código" **4 veces rápidamente** (en menos de 1 minuto)
5. **Resultado esperado:**
   - Las primeras 3 solicitudes funcionan
   - La 4ta muestra error 429
   - Aparece un contador regresivo
   - El botón se deshabilita durante la espera

### Prueba 2: Rate Limiting de Solicitud de Enlace

1. Ve a la pantalla de "Recuperar contraseña"
2. Ingresa un email
3. Haz clic en "Solicitar enlace" **4 veces rápidamente**
4. **Resultado esperado:**
   - Las primeras 3 solicitudes funcionan
   - La 4ta muestra error 429
   - Aparece un contador regresivo
   - El botón se deshabilita durante la espera

## 🔍 Códigos de Estado HTTP a Manejar

| Código | Significado | Acción del Frontend |
|--------|-------------|---------------------|
| `200` | ✅ Éxito | Mostrar mensaje de éxito |
| `400` | ❌ Bad Request | Mostrar mensaje de error del backend |
| `404` | ❌ Not Found | Mostrar "Endpoint no encontrado" |
| `429` | ⚠️ Too Many Requests | **Mostrar contador regresivo y deshabilitar botón** |
| `500` | ❌ Server Error | Mostrar "Error del servidor, intenta más tarde" |

## 💡 Mejora de UX: Persistir el Tiempo de Espera

Si quieres que el tiempo de espera persista aunque el usuario recargue la página:

```jsx
// Guardar en localStorage
useEffect(() => {
  if (countdown !== null) {
    localStorage.setItem('recoveryRateLimit', JSON.stringify({
      expiresAt: Date.now() + (countdown * 1000),
      endpoint: 'reenviar-codigo' // o 'solicitar-enlace'
    }));
  }
}, [countdown]);

// Recuperar al cargar el componente
useEffect(() => {
  const saved = localStorage.getItem('recoveryRateLimit');
  if (saved) {
    const { expiresAt, endpoint } = JSON.parse(saved);
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    if (remaining > 0 && endpoint === 'reenviar-codigo') {
      setCountdown(remaining);
    }
  }
}, []);
```

## 📚 Referencias

- **Endpoint OTP**: `POST /api/usuarios/reenviar-codigo`
- **Endpoint Enlace**: `POST /api/usuarios/solicitar-enlace-recuperacion`
- **Límite**: 3 intentos por minuto por IP
- **Error**: 429 Too Many Requests
- **Campo `retryAfter`**: Segundos hasta que se puede intentar nuevamente

## ✅ Resumen

1. **Detectar error 429** en las respuestas del backend
2. **Extraer `retryAfter`** del cuerpo de la respuesta
3. **Mostrar contador regresivo** al usuario
4. **Deshabilitar el botón** durante la espera
5. **Mantener el email** en el campo (no borrarlo)

¡Con estos cambios, tu frontend manejará correctamente el rate limiting del backend!

