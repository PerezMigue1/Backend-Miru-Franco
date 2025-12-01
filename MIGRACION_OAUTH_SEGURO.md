# 🔐 Guía: Migración para OAuth2.0 Seguro

## 📋 Resumen

Esta migración implementa **Authorization Code Flow** para OAuth2.0, eliminando la exposición de tokens JWT en las URLs y mejorando la seguridad.

## 🎯 Problema Resuelto

**Antes (Inseguro):**
```
https://frontend.com/auth/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
❌ El token JWT se expone en la URL
❌ Puede ser capturado en logs del servidor
❌ Puede ser visible en historial del navegador
❌ Puede ser compartido accidentalmente

**Después (Seguro):**
```
https://frontend.com/auth/callback?code=a1b2c3d4e5f6...
```
✅ Solo se pasa un código temporal
✅ El código expira en 5 minutos
✅ El código solo puede usarse una vez
✅ El token se obtiene mediante POST seguro

## 🔧 Cambios Implementados

### 1. Nueva Tabla en Base de Datos

Se crea la tabla `codigos_oauth` para almacenar códigos temporales:

```sql
CREATE TABLE "codigos_oauth" (
  "id" TEXT PRIMARY KEY,
  "codigo" TEXT UNIQUE,
  "token" TEXT,
  "expira_en" TIMESTAMP,
  "usado" BOOLEAN DEFAULT false,
  "creado_en" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Nuevo Flujo de Autenticación

**Paso 1:** Usuario inicia sesión con Google
```
GET /api/auth/google
→ Redirige a Google
```

**Paso 2:** Google redirige al callback
```
GET /api/auth/google/callback
→ Genera código temporal
→ Redirige a: /auth/callback?code=ABC123
```

**Paso 3:** Frontend intercambia código por token
```
POST /api/auth/exchange-code
Body: { "code": "ABC123" }
→ Retorna: { "token": "eyJhbGci..." }
```

## 📝 Aplicar la Migración

### Opción 1: Desde Neon SQL Editor (Recomendado)

1. **Abre tu base de datos en Neon:**
   - Ve a https://console.neon.tech
   - Selecciona tu proyecto
   - Abre el **SQL Editor**

2. **Ejecuta el siguiente SQL:**
   ```sql
   -- Crear tabla para códigos temporales de OAuth
   CREATE TABLE IF NOT EXISTS "codigos_oauth" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "codigo" TEXT NOT NULL UNIQUE,
     "token" TEXT NOT NULL,
     "expira_en" TIMESTAMP NOT NULL,
     "usado" BOOLEAN NOT NULL DEFAULT false,
     "creado_en" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   );

   -- Índices para mejorar rendimiento
   CREATE INDEX IF NOT EXISTS "idx_codigos_oauth_codigo" ON "codigos_oauth"("codigo");
   CREATE INDEX IF NOT EXISTS "idx_codigos_oauth_expira_en" ON "codigos_oauth"("expira_en");
   ```

3. **Verificar que se aplicó correctamente:**
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_name = 'codigos_oauth';
   ```

### Opción 2: Desde el archivo SQL

El archivo `prisma/migrations/add_codigos_oauth.sql` contiene el SQL necesario.

## 🔄 Actualizar el Frontend

### Cambio Requerido

**Antes:**
```jsx
// ❌ INSEGURO - El token venía en la URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
localStorage.setItem('token', token);
```

**Después:**
```jsx
// ✅ SEGURO - Intercambiar código por token
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');

if (code) {
  // Intercambiar código por token
  const response = await fetch('https://miru-franco.onrender.com/api/auth/exchange-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });

  const data = await response.json();
  if (data.success && data.token) {
    localStorage.setItem('token', data.token);
    // Redirigir a dashboard
    window.location.href = '/dashboard';
  }
}
```

### Ejemplo Completo (React/Next.js)

```jsx
// pages/auth/callback.jsx o components/AuthCallback.jsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import api from '../utils/axios';

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      const { code, error: errorParam } = router.query;

      // Si hay error de OAuth
      if (errorParam) {
        setError('Error en la autenticación');
        setLoading(false);
        setTimeout(() => router.push('/login'), 3000);
        return;
      }

      // Si hay código, intercambiarlo por token
      if (code) {
        try {
          const response = await api.post('/auth/exchange-code', { code });
          
          if (response.data.success && response.data.token) {
            // Guardar token
            localStorage.setItem('token', response.data.token);
            
            // Redirigir al dashboard
            router.push('/dashboard');
          } else {
            setError('Error al obtener token');
            setLoading(false);
          }
        } catch (error) {
          console.error('Error intercambiando código:', error);
          setError('Error al intercambiar código por token');
          setLoading(false);
          setTimeout(() => router.push('/login'), 3000);
        }
      } else {
        setError('Código no proporcionado');
        setLoading(false);
        setTimeout(() => router.push('/login'), 3000);
      }
    };

    if (router.isReady) {
      handleCallback();
    }
  }, [router.isReady, router.query]);

  if (loading) {
    return <div>Procesando autenticación...</div>;
  }

  if (error) {
    return (
      <div>
        <p>Error: {error}</p>
        <p>Redirigiendo al login...</p>
      </div>
    );
  }

  return null;
}
```

## ✅ Verificar que Funciona

### 1. Probar el Flujo Completo

1. **Iniciar sesión con Google:**
   ```
   GET /api/auth/google
   ```

2. **Verificar redirección:**
   - Debe redirigir a Google
   - Después de autenticar, debe redirigir a: `/auth/callback?code=ABC123`
   - ✅ NO debe aparecer `token=` en la URL

3. **Intercambiar código por token:**
   ```bash
   POST /api/auth/exchange-code
   Content-Type: application/json
   
   {
     "code": "ABC123"
   }
   ```

4. **Resultado esperado:**
   ```json
   {
     "success": true,
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
   ```

### 2. Verificar Seguridad

- ✅ El token NO aparece en la URL
- ✅ El código expira en 5 minutos
- ✅ El código solo puede usarse una vez
- ✅ Los logs NO contienen tokens completos

### 3. Verificar en Base de Datos

```sql
-- Ver códigos generados
SELECT codigo, usado, expira_en, creado_en 
FROM codigos_oauth 
ORDER BY creado_en DESC 
LIMIT 10;

-- Verificar que códigos usados están marcados
SELECT COUNT(*) 
FROM codigos_oauth 
WHERE usado = true;
```

## 🔒 Características de Seguridad

### 1. Código Temporal
- ✅ Generado con `crypto.randomBytes(32)` (64 caracteres hex)
- ✅ Único e impredecible
- ✅ Expira en 5 minutos

### 2. Single-Use (Un Solo Uso)
- ✅ Una vez usado, se marca como `usado = true`
- ✅ No puede reutilizarse
- ✅ Previene ataques de replay

### 3. Sin Exposición en URLs
- ✅ El token JWT nunca aparece en la URL
- ✅ Solo el código temporal aparece
- ✅ El código no tiene valor sin el servidor

### 4. Logs Seguros
- ✅ Los logs NO contienen tokens completos
- ✅ Solo se loggea información del usuario (id, email)
- ✅ Los errores no exponen tokens

## 🧹 Limpieza Automática

Los códigos expirados y usados se pueden limpiar periódicamente:

```typescript
// Ejecutar periódicamente (ej: cada hora)
await authService.limpiarCodigosExpirados();
```

O manualmente en SQL:

```sql
-- Limpiar códigos expirados o usados
DELETE FROM codigos_oauth 
WHERE usado = true 
   OR expira_en < NOW();
```

## 📊 Comparación: Antes vs Después

| Aspecto | Antes (Inseguro) | Después (Seguro) |
|---------|------------------|------------------|
| **Token en URL** | ❌ Sí | ✅ No |
| **Token en logs** | ⚠️ Posible | ✅ No |
| **Reutilizable** | ❌ Sí | ✅ No (single-use) |
| **Expiración** | ⚠️ Solo del token | ✅ Código: 5 min |
| **Flujo** | ❌ Implicit Flow | ✅ Authorization Code Flow |

## ⚠️ Notas Importantes

1. **Compatibilidad con Frontend:**
   - El frontend DEBE actualizarse para usar el nuevo endpoint
   - El código anterior seguirá funcionando pero es inseguro

2. **Códigos Expirados:**
   - Los códigos expiran en 5 minutos
   - Si el usuario tarda más, debe iniciar sesión nuevamente

3. **Limpieza:**
   - Los códigos usados/expirados se pueden limpiar periódicamente
   - No afectan el rendimiento si se limpian regularmente

## ✅ Checklist

- [ ] Ejecutar migración SQL en Neon
- [ ] Verificar que la tabla existe
- [ ] Actualizar frontend para usar `/auth/exchange-code`
- [ ] Probar flujo completo de OAuth
- [ ] Verificar que el token NO aparece en la URL
- [ ] Verificar que los logs NO contienen tokens
- [ ] Configurar limpieza periódica de códigos (opcional)

## 🎉 Resultado

Después de esta migración, OAuth2.0 está implementado de forma segura siguiendo el **Authorization Code Flow**, cumpliendo con las mejores prácticas de seguridad.

¡Listo! 🎉

