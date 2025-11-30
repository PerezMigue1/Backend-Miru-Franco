# 🔄 Solución: Recarga Automática en Login

## Problema
1. ❌ La página se recarga automáticamente al hacer login
2. ❌ Los campos del formulario (email y contraseña) se borran después de un error
3. ❌ No se muestran los mensajes de error del backend
4. ❌ El usuario no sabe si el error es del email o de la contraseña

## Causa
El formulario HTML está haciendo submit sin prevenir el comportamiento por defecto del navegador, lo que causa:
- Recarga automática de la página
- Pérdida de los valores de los campos
- Pérdida de los mensajes de error

## Solución

### 1. Prevenir el comportamiento por defecto del formulario

**Si usas un formulario HTML tradicional:**

```jsx
// ❌ INCORRECTO - Causa recarga
const handleSubmit = () => {
  // Hacer petición al backend
  fetch('/api/usuarios/login', { ... });
};

<form onSubmit={handleSubmit}>
  {/* campos del formulario */}
</form>
```

```jsx
// ✅ CORRECTO - Previene recarga
const handleSubmit = (e) => {
  e.preventDefault(); // ← IMPORTANTE: Prevenir comportamiento por defecto
  
  // Hacer petición al backend
  fetch('/api/usuarios/login', { ... });
};

<form onSubmit={handleSubmit}>
  {/* campos del formulario */}
</form>
```

### 2. Ejemplo completo con React/Next.js (con manejo de errores)

```jsx
import { useState } from 'react';
import { useRouter } from 'next/router';

export default function LoginPage() {
  // ✅ MANTENER los valores de los campos (NO se borran después de error)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // ✅ Estados para manejar errores y loading
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState(''); // 'email', 'password', 'account', 'general'
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault(); // ← CRÍTICO: Prevenir recarga y mantener campos
    
    // Limpiar errores anteriores
    setError('');
    setErrorType('');
    setLoading(true);

    try {
      const response = await fetch('https://miru-franco.onrender.com/api/usuarios/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      // ✅ Manejar diferentes tipos de errores del backend
      if (!response.ok) {
        // Determinar tipo de error según el código de estado
        if (response.status === 401) {
          // Credenciales inválidas (email o contraseña incorrectos)
          setErrorType('credentials');
          setError('El correo electrónico o la contraseña son incorrectos. Por favor, verifica tus credenciales.');
        } else if (response.status === 403) {
          // Cuenta bloqueada o no activada
          if (data.message?.includes('activada') || data.message?.includes('activar')) {
            setErrorType('account');
            setError('Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.');
          } else if (data.message?.includes('bloqueada')) {
            setErrorType('account');
            setError(data.message || 'Cuenta bloqueada temporalmente por múltiples intentos fallidos.');
          } else {
            setErrorType('account');
            setError(data.message || 'Acceso denegado. Contacta al soporte si el problema persiste.');
          }
        } else if (response.status === 429) {
          // Rate limiting
          setErrorType('rateLimit');
          setError('Demasiados intentos. Por favor, espera unos minutos antes de intentar nuevamente.');
        } else {
          // Otros errores
          setErrorType('general');
          setError(data.message || 'Error al iniciar sesión. Por favor, intenta nuevamente.');
        }
        
        // ✅ IMPORTANTE: NO hacer return aquí, dejar que el finally se ejecute
        // Los campos se mantienen porque NO recargamos la página
        return;
      }

      // ✅ Login exitoso
      // Guardar token
      if (data.token) {
        localStorage.setItem('token', data.token);
        // O usar cookies, según tu implementación
      }

      // Redirigir sin recargar la página
      router.push('/dashboard'); // Next.js
      // O window.location.href = '/dashboard'; // React puro
      
    } catch (err) {
      // ✅ Manejar errores de red u otros errores
      console.error('Error en login:', err);
      setErrorType('general');
      setError('Error de conexión. Verifica tu internet e intenta nuevamente.');
    } finally {
      setLoading(false);
      // ✅ Los campos (email, password) se mantienen porque NO recargamos la página
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Email:</label>
        <input
          type="email"
          value={email} // ✅ Se mantiene después de error
          onChange={(e) => setEmail(e.target.value)}
          required
          className={errorType === 'credentials' ? 'error' : ''} // Opcional: estilo visual
        />
      </div>
      
      <div>
        <label>Contraseña:</label>
        <input
          type="password"
          value={password} // ✅ Se mantiene después de error
          onChange={(e) => setPassword(e.target.value)}
          required
          className={errorType === 'credentials' ? 'error' : ''} // Opcional: estilo visual
        />
      </div>

      {/* ✅ Mostrar error de forma visible y clara */}
      {error && (
        <div 
          style={{ 
            color: 'red', 
            padding: '10px',
            margin: '10px 0',
            backgroundColor: '#ffe6e6',
            border: '1px solid #ff9999',
            borderRadius: '4px'
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      <button type="submit" disabled={loading}>
        {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
```

### 3. Si usas un botón fuera del formulario

```jsx
// ✅ CORRECTO - Botón con type="button"
<button type="button" onClick={handleSubmit}>
  Iniciar sesión
</button>

// ❌ INCORRECTO - Botón sin type (por defecto es "submit" si está dentro de un form)
<button onClick={handleSubmit}>
  Iniciar sesión
</button>
```

### 4. Verificar en tu código actual

Busca en tu código del frontend:

1. **¿Tienes un `<form>`?**
   ```jsx
   // Busca esto:
   <form onSubmit={...}>
   ```

2. **¿El handler tiene `e.preventDefault()`?**
   ```jsx
   // Debe tener esto:
   const handleSubmit = (e) => {
     e.preventDefault(); // ← Debe estar aquí
     // ... resto del código
   };
   ```

3. **¿Estás usando `async/await` correctamente?**
   ```jsx
   // ✅ CORRECTO
   const handleSubmit = async (e) => {
     e.preventDefault();
     await fetch(...);
   };

   // ❌ INCORRECTO - Puede causar problemas
   const handleSubmit = (e) => {
     e.preventDefault();
     fetch(...).then(...); // Sin await puede causar problemas
   };
   ```

## Respuestas del backend

### ✅ Login exitoso (200 OK)

```json
{
  "success": true,
  "message": "Inicio de sesión exitoso",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "usuario": {
    "_id": "uuid-del-usuario",
    "nombre": "Nombre del Usuario",
    "email": "usuario@example.com"
  }
}
```

### ❌ Errores del backend

#### 401 Unauthorized - Credenciales inválidas
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Credenciales inválidas",
  "error": "Unauthorized"
}
```
**Causa:** Email o contraseña incorrectos

#### 403 Forbidden - Cuenta no activada
```json
{
  "success": false,
  "statusCode": 403,
  "message": "Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.",
  "error": "Forbidden"
}
```
**Causa:** El usuario no ha verificado su email con el código OTP

#### 403 Forbidden - Cuenta bloqueada
```json
{
  "success": false,
  "statusCode": 403,
  "message": "Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en X minutos.",
  "error": "Forbidden"
}
```
**Causa:** Demasiados intentos fallidos de login

#### 429 Too Many Requests - Rate limiting
```json
{
  "success": false,
  "statusCode": 429,
  "message": "Demasiadas solicitudes. Intenta más tarde.",
  "error": "Too Many Requests"
}
```
**Causa:** Demasiadas peticiones en poco tiempo

## Checklist de verificación

- [ ] El formulario tiene `onSubmit={handleSubmit}`
- [ ] El handler tiene `e.preventDefault()` como primera línea
- [ ] El handler es `async` si usas `await`
- [ ] Los botones dentro del form tienen `type="submit"` o `type="button"`
- [ ] No hay `window.location.reload()` después del login exitoso
- [ ] La redirección se hace con `router.push()` o `window.location.href` (no `window.location.reload()`)

## Debugging

Si el problema persiste, agrega esto temporalmente para ver qué está pasando:

```jsx
const handleSubmit = (e) => {
  e.preventDefault();
  console.log('Formulario enviado, pero recarga prevenida');
  
  // Tu código de login aquí
};
```

Si ves el mensaje en la consola pero la página aún se recarga, el problema está en otro lugar (posiblemente en un `useEffect` o en la lógica de redirección).

## Ejemplo con Axios (con manejo completo de errores)

```jsx
import axios from 'axios';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState(''); // ✅ Se mantiene después de error
  const [password, setPassword] = useState(''); // ✅ Se mantiene después de error
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); // ← CRÍTICO: Prevenir recarga
    
    setError('');
    setLoading(true);
    
    try {
      const response = await axios.post(
        'https://miru-franco.onrender.com/api/usuarios/login',
        { email, password }
      );
      
      // ✅ Login exitoso
      localStorage.setItem('token', response.data.token);
      router.push('/dashboard');
      
    } catch (error) {
      // ✅ Manejar diferentes tipos de errores
      if (error.response) {
        // El servidor respondió con un código de error
        const status = error.response.status;
        const message = error.response.data?.message || 'Error al iniciar sesión';
        
        if (status === 401) {
          setError('El correo electrónico o la contraseña son incorrectos.');
        } else if (status === 403) {
          setError(message);
        } else if (status === 429) {
          setError('Demasiados intentos. Por favor, espera unos minutos.');
        } else {
          setError(message);
        }
      } else if (error.request) {
        // La petición se hizo pero no hubo respuesta
        setError('Error de conexión. Verifica tu internet e intenta nuevamente.');
      } else {
        // Algo más causó el error
        setError('Error inesperado. Por favor, intenta nuevamente.');
      }
      
      // ✅ Los campos se mantienen porque NO recargamos la página
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Campos del formulario */}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <button type="submit" disabled={loading}>
        {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
```

## Puntos clave para solucionar tu problema

### ✅ Lo que DEBES hacer:

1. **`e.preventDefault()`** - Primera línea del handler
   ```jsx
   const handleSubmit = async (e) => {
     e.preventDefault(); // ← ESTO previene la recarga
     // ... resto del código
   };
   ```

2. **Mantener valores con `useState`** - Los campos NO se borran
   ```jsx
   const [email, setEmail] = useState(''); // ✅ Se mantiene
   const [password, setPassword] = useState(''); // ✅ Se mantiene
   ```

3. **Manejar errores sin recargar** - Mostrar mensajes sin recargar
   ```jsx
   if (!response.ok) {
     setError(data.message); // ✅ Muestra error
     return; // ✅ NO recarga, los campos se mantienen
   }
   ```

4. **NO usar `window.location.reload()`** - Nunca recargues manualmente
   ```jsx
   // ❌ NUNCA hagas esto después de un error:
   window.location.reload();
   
   // ✅ En su lugar, solo muestra el error:
   setError('Mensaje de error');
   ```

### ❌ Lo que NO debes hacer:

1. **NO omitir `e.preventDefault()`**
2. **NO usar `window.location.reload()` después de errores**
3. **NO hacer submit del formulario de forma tradicional**
4. **NO borrar los campos manualmente después de un error**

## Ejemplo avanzado: Errores específicos por campo

Si quieres mostrar errores más específicos (aunque el backend no diferencia entre email y contraseña por seguridad):

```jsx
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); // ← CRÍTICO
    
    // Limpiar errores anteriores
    setEmailError('');
    setPasswordError('');
    setGeneralError('');
    setLoading(true);

    try {
      const response = await fetch('https://miru-franco.onrender.com/api/usuarios/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          // Credenciales inválidas - mostrar en ambos campos
          setEmailError('Verifica tu correo electrónico');
          setPasswordError('Verifica tu contraseña');
          setGeneralError('El correo o la contraseña son incorrectos');
        } else if (response.status === 403) {
          setGeneralError(data.message);
        } else {
          setGeneralError(data.message || 'Error al iniciar sesión');
        }
        return; // ✅ NO recarga, campos se mantienen
      }

      // Login exitoso
      localStorage.setItem('token', data.token);
      router.push('/dashboard');
      
    } catch (err) {
      setGeneralError('Error de conexión. Verifica tu internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Email:</label>
        <input
          type="email"
          value={email} // ✅ Se mantiene
          onChange={(e) => setEmail(e.target.value)}
          className={emailError ? 'error' : ''}
        />
        {emailError && <span style={{ color: 'red', fontSize: '12px' }}>{emailError}</span>}
      </div>
      
      <div>
        <label>Contraseña:</label>
        <input
          type="password"
          value={password} // ✅ Se mantiene
          onChange={(e) => setPassword(e.target.value)}
          className={passwordError ? 'error' : ''}
        />
        {passwordError && <span style={{ color: 'red', fontSize: '12px' }}>{passwordError}</span>}
      </div>

      {generalError && (
        <div style={{ color: 'red', padding: '10px', backgroundColor: '#ffe6e6' }}>
          {generalError}
        </div>
      )}

      <button type="submit" disabled={loading}>
        {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
```

## Resumen rápido de la solución

### ✅ Checklist para tu código frontend:

1. **Formulario con `onSubmit`**
   ```jsx
   <form onSubmit={handleSubmit}>
   ```

2. **Handler con `e.preventDefault()`**
   ```jsx
   const handleSubmit = async (e) => {
     e.preventDefault(); // ← PRIMERA LÍNEA
     // ... resto
   };
   ```

3. **Estados para mantener valores**
   ```jsx
   const [email, setEmail] = useState(''); // ✅ Se mantiene
   const [password, setPassword] = useState(''); // ✅ Se mantiene
   ```

4. **Manejo de errores sin recargar**
   ```jsx
   if (!response.ok) {
     setError(data.message); // ✅ Muestra error
     return; // ✅ NO recarga
   }
   ```

5. **Inputs controlados**
   ```jsx
   <input value={email} onChange={(e) => setEmail(e.target.value)} />
   ```

### ❌ Lo que NO debes hacer:

- ❌ Omitir `e.preventDefault()`
- ❌ Usar `window.location.reload()`
- ❌ Borrar campos después de error: `setEmail('')` o `setPassword('')`
- ❌ Hacer submit tradicional del formulario

## Nota importante

El backend **NO está causando** la recarga. El endpoint devuelve JSON correctamente con mensajes de error específicos. El problema está 100% en el frontend, específicamente en cómo se maneja el evento `submit` del formulario.

**El backend ya está funcionando correctamente** y devuelve mensajes de error claros. Solo necesitas:
1. Prevenir la recarga con `e.preventDefault()`
2. Mantener los valores de los campos con `useState`
3. Mostrar los mensajes de error del backend

