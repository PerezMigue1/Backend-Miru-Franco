# 🔐 Guía de Seguridad para Frontend

## 📋 Resumen de Medidas de Seguridad Implementadas en el Backend

El backend ahora implementa las siguientes medidas de seguridad:

### ✅ Validación de Contraseñas
- **Mínimo 8 caracteres**
- **Al menos una letra mayúscula**
- **Al menos una letra minúscula**
- **Al menos un número**

### ✅ Protección contra Fuerza Bruta
- **Bloqueo de cuenta** después de 5 intentos fallidos de login
- **Bloqueo temporal** de 15 minutos
- **Rate limiting** en endpoints críticos

### ✅ Headers de Seguridad HTTP
- **X-Content-Type-Options**: `nosniff`
- **X-Frame-Options**: `DENY` (previene clickjacking)
- **X-XSS-Protection**: `1; mode=block`
- **Strict-Transport-Security**: HSTS (solo en producción)
- **Content-Security-Policy**: CSP configurado
- **Referrer-Policy**: `strict-origin-when-cross-origin`

### ✅ Protección contra Inyección
- **Sanitización de entrada** automática
- **Validación contra SQL injection**
- **Validación contra XSS**

### ✅ Logging Seguro
- **No se registran contraseñas** ni datos sensibles
- **Sanitización de logs** automática

---

## 🎨 Implementación en el Frontend

### 1. Validación de Contraseñas

**En el formulario de registro/cambio de contraseña:**

```typescript
const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: 'La contraseña debe tener al menos 8 caracteres' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'La contraseña debe incluir al menos una letra mayúscula' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'La contraseña debe incluir al menos una letra minúscula' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'La contraseña debe incluir al menos un número' };
  }
  
  return { valid: true };
};

// Uso en formulario
const [password, setPassword] = useState('');
const [passwordError, setPasswordError] = useState('');

const handlePasswordChange = (value: string) => {
  setPassword(value);
  const validation = validatePassword(value);
  if (!validation.valid) {
    setPasswordError(validation.message || '');
  } else {
    setPasswordError('');
  }
};
```

### 2. Manejo de Errores de Bloqueo de Cuenta

```typescript
const handleLogin = async (email: string, password: string) => {
  try {
    const response = await fetch(`${API_URL}/api/usuarios/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok) {
      // Login exitoso
      localStorage.setItem('authToken', data.token);
      router.push('/dashboard');
    } else {
      // Manejar diferentes tipos de errores
      if (data.message?.includes('bloqueada temporalmente')) {
        // Extraer tiempo de bloqueo
        const match = data.message.match(/(\d+) minutos/);
        const minutos = match ? match[1] : '15';
        alert(`Tu cuenta está bloqueada. Intenta de nuevo en ${minutos} minutos.`);
      } else if (response.status === 429) {
        // Rate limiting
        alert('Demasiados intentos. Espera un momento antes de intentar de nuevo.');
      } else {
        // Otro error
        alert(data.message || 'Credenciales inválidas');
      }
    }
  } catch (error) {
    console.error('Error en login:', error);
    alert('Error al iniciar sesión. Intenta de nuevo.');
  }
};
```

### 3. Sanitización de Entrada en el Frontend

```typescript
// Función de sanitización básica
const sanitizeInput = (input: string): string => {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
};

// Usar al procesar formularios
const handleSubmit = (formData: any) => {
  const sanitizedData = {
    nombre: sanitizeInput(formData.nombre),
    email: sanitizeInput(formData.email.toLowerCase()),
    // ... otros campos
  };
  
  // Enviar a API
  fetch(`${API_URL}/api/usuarios/registrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedData),
  });
};
```

### 4. Rate Limiting en el Frontend

```typescript
// Implementar retry con backoff exponencial
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 1000
): Promise<Response> => {
  try {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      // Rate limited
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;
      
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchWithRetry(url, options, retries - 1, delay * 2);
      }
    }
    
    return response;
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw error;
  }
};
```

### 5. Manejo Seguro de Tokens JWT

```typescript
// Guardar token de forma segura
const saveToken = (token: string) => {
  // En producción, considerar usar httpOnly cookies en lugar de localStorage
  localStorage.setItem('authToken', token);
};

// Enviar token en headers
const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('authToken');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };
};

// Cerrar sesión y limpiar token
const logout = async () => {
  // Opcional: notificar al backend que el token está revocado
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
  } finally {
    localStorage.removeItem('authToken');
    router.push('/login');
  }
};
```

### 6. Protección contra XSS en React

```typescript
// React sanitiza automáticamente, pero cuidado con dangerouslySetInnerHTML
// ❌ NO HACER:
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ✅ HACER:
<div>{userInput}</div>

// Si necesitas HTML, usar DOMPurify
import DOMPurify from 'dompurify';

<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />
```

### 7. Configuración de Cookies Seguras (si usas cookies)

```typescript
// En producción, configurar cookies con flags de seguridad
document.cookie = `token=${token}; Secure; HttpOnly; SameSite=Strict; Max-Age=86400; Path=/`;
```

---

## ⚠️ Consideraciones Importantes

### 1. HTTPS en Producción
- **Siempre usar HTTPS** en producción
- No enviar credenciales sobre HTTP
- Verificar certificados SSL válidos

### 2. Almacenamiento de Tokens
- **localStorage**: Conveniente pero vulnerable a XSS
- **httpOnly cookies**: Más seguro pero requiere configuración especial
- **Consideración**: Para máxima seguridad, usar httpOnly cookies

### 3. Manejo de Errores
- **No mostrar mensajes de error detallados** al usuario final
- **No revelar información sobre existencia de usuarios** (ej: "Usuario no encontrado")
- **Usar mensajes genéricos**: "Credenciales inválidas" en lugar de "Usuario no existe"

### 4. Rate Limiting
- **Respetar los límites** del backend
- **Mostrar mensajes claros** cuando se alcance el límite
- **Implementar backoff exponencial** para reintentos

---

## ✅ Checklist de Seguridad para Frontend

- [ ] Validar contraseñas según requisitos (8+ caracteres, mayúscula, minúscula, número)
- [ ] Sanitizar todas las entradas de usuario
- [ ] Manejar errores de bloqueo de cuenta apropiadamente
- [ ] Implementar rate limiting/retry en el frontend
- [ ] Usar HTTPS en producción
- [ ] No almacenar contraseñas en texto plano
- [ ] No mostrar mensajes de error detallados
- [ ] No revelar si un usuario existe o no
- [ ] Implementar logout que revoque tokens
- [ ] Validar tokens antes de mostrar contenido protegido
- [ ] Proteger contra XSS usando React's default escaping
- [ ] Implementar CSP headers en el frontend (si es posible)

---

## 📚 Referencias

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [React Security Best Practices](https://reactjs.org/docs/dom-elements.html#dangerouslysetinnerhtml)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)


