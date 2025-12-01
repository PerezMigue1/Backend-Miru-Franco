# ✅ Verificación: Tokens JWT Seguros

## 📋 Estado de Implementación

**✅ IMPLEMENTADO** - Los tokens JWT están configurados de forma segura.

## 🔍 Verificación Detallada

### 1. Estructura del Token (header.payload.signature)

**✅ Implementado**

Los tokens JWT tienen la estructura estándar de tres partes separadas por puntos:

```
header.payload.signature
```

**Ejemplo de token:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMzQ1NiIsImVtYWlsIjoidGVzdEB0ZXN0LmNvbSIsImV4cCI6MTY5OTk5OTk5OX0.signature
```

**Verificación:**
- ✅ Los tokens se generan con `jwtService.sign()` que crea la estructura estándar
- ✅ Header, payload y signature están separados por puntos
- ✅ Cada parte está codificada en Base64URL

### 2. Algoritmo de Firma (HS256)

**✅ Implementado**

El sistema usa **HS256** (HMAC con SHA-256), que es un algoritmo simétrico seguro.

**Configuración actual:**
```typescript
// src/auth/auth.module.ts
JwtModule.registerAsync({
  useFactory: async (configService: ConfigService) => ({
    secret: configService.get<string>('JWT_SECRET'),
    signOptions: { expiresIn: '7d' },
  }),
})
```

**Características:**
- ✅ Usa `secret` (clave simétrica) → Algoritmo HS256 por defecto
- ✅ La clave secreta se obtiene de variable de entorno `JWT_SECRET`
- ✅ Algoritmo robusto y ampliamente utilizado

**Nota sobre RS256:**
- RS256 (RSA con SHA-256) requiere un par de claves (pública/privada)
- HS256 es adecuado para aplicaciones monolíticas donde el mismo servidor firma y verifica
- Para microservicios distribuidos, RS256 podría ser preferible

### 3. Expiración Definida

**✅ Implementado**

Los tokens tienen expiración configurada en múltiples lugares:

#### Configuración en AuthModule:
```typescript
// src/auth/auth.module.ts
signOptions: { expiresIn: '7d' }  // 7 días
```

#### Configuración en UsuariosModule:
```typescript
// src/usuarios/usuarios.module.ts
signOptions: { expiresIn: '1d' }  // 1 día
```

#### Uso en código:
```typescript
// src/auth/auth.service.ts
return this.jwtService.sign(payload, { expiresIn: '7d' });

// src/usuarios/usuarios.service.ts
const token = this.jwtService.sign(payload, { expiresIn: '1d' });
```

**Tiempos de expiración:**
- ✅ **Login normal**: 1 día (`UsuariosService.login()`)
- ✅ **OAuth/Google**: 7 días (`AuthService.generateToken()`)
- ✅ **Refresh token**: 7 días (si se implementa)

**Verificación en el token:**
- ✅ El campo `exp` (expiration time) se agrega automáticamente
- ✅ Se calcula como `iat + expiresIn`
- ✅ Se valida automáticamente por Passport JWT Strategy

### 4. Campos del Payload

**✅ Implementado**

El payload incluye campos seguros y necesarios:

```typescript
{
  id: string,           // ID del usuario
  email: string,         // Email del usuario
  jti: string,          // Token ID único (para revocación)
  iat: number,          // Issued at time (para logout global)
  exp: number,          // Expiration time (automático)
  lastActivity?: number // Última actividad (opcional)
}
```

**Buenas prácticas implementadas:**
- ✅ No incluye información sensible (contraseñas, tokens, etc.)
- ✅ Incluye `jti` (JWT ID) para identificación única
- ✅ Incluye `iat` para rastrear cuándo se emitió
- ✅ `exp` se agrega automáticamente

### 5. Validación del Token

**✅ Implementado**

La validación se realiza en múltiples capas:

1. **Validación de firma** (automática por Passport):
   ```typescript
   // src/auth/strategies/jwt.strategy.ts
   secretOrKey: configService.get<string>('JWT_SECRET')
   ```

2. **Validación de expiración** (automática):
   ```typescript
   ignoreExpiration: false  // Valida exp automáticamente
   ```

3. **Validación de revocación** (custom):
   ```typescript
   const isRevoked = await this.securityService.isTokenRevoked(rawToken);
   ```

4. **Validación de logout global** (custom):
   ```typescript
   const isRevokedByGlobalLogout = await this.securityService
     .isTokenRevokedByGlobalLogout(payload.id, payload.iat);
   ```

5. **Validación de inactividad** (custom):
   ```typescript
   const isInactive = await this.securityService.isUserInactive(payload.id, 15);
   ```

## 🧪 Cómo Verificar

### 1. Verificar Estructura del Token

```bash
# 1. Obtener un token
POST /api/usuarios/login
{
  "email": "test@test.com",
  "password": "Password123"
}

# 2. Decodificar en jwt.io
# Ir a: https://jwt.io
# Pegar el token completo
```

**Resultado esperado:**
- ✅ Token tiene 3 partes separadas por puntos
- ✅ Header decodificado muestra: `{"alg":"HS256","typ":"JWT"}`
- ✅ Payload decodificado muestra: `id`, `email`, `jti`, `iat`, `exp`
- ✅ `exp` es una fecha futura

### 2. Verificar Algoritmo

**En jwt.io:**
- ✅ Header muestra: `"alg": "HS256"`
- ✅ Tipo muestra: `"typ": "JWT"`

**En código:**
```bash
grep -r "JWT_SECRET" src/
# Debe mostrar uso de secret (indica HS256)
```

### 3. Verificar Expiración

**En jwt.io:**
- ✅ Payload muestra campo `exp`
- ✅ `exp` es un número (Unix timestamp)
- ✅ `exp` es mayor que `iat` (emitido antes de expirar)

**Calcular tiempo restante:**
```javascript
const now = Math.floor(Date.now() / 1000);
const timeRemaining = payload.exp - now;
const daysRemaining = timeRemaining / (60 * 60 * 24);
console.log(`Token expira en ${daysRemaining} días`);
```

### 4. Verificar Validación

```bash
# 1. Usar token válido
GET /api/auth/me
Authorization: Bearer <token>
# Debe funcionar ✅

# 2. Modificar el token (cambiar un carácter)
GET /api/auth/me
Authorization: Bearer <token_modificado>
# Debe dar error 401 "Token inválido" ✅

# 3. Esperar a que expire (o modificar exp en jwt.io)
GET /api/auth/me
Authorization: Bearer <token_expirado>
# Debe dar error 401 "Token expirado" ✅
```

## 📊 Resumen de Configuración

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| **Estructura** | ✅ | header.payload.signature |
| **Algoritmo** | ✅ | HS256 (HMAC SHA-256) |
| **Expiración** | ✅ | 1 día (login) / 7 días (OAuth) |
| **Secret** | ✅ | Variable de entorno `JWT_SECRET` |
| **Validación** | ✅ | Firma, expiración, revocación, inactividad |
| **Payload seguro** | ✅ | No incluye datos sensibles |
| **JTI único** | ✅ | Token ID único para revocación |
| **IAT** | ✅ | Issued at time para logout global |

## 🔒 Mejoras Opcionales (No Requeridas)

### 1. Usar RS256 para Microservicios

Si en el futuro necesitas distribuir la verificación de tokens:

```typescript
// Cambiar a RS256
JwtModule.registerAsync({
  useFactory: async (configService: ConfigService) => ({
    publicKey: configService.get<string>('JWT_PUBLIC_KEY'),
    privateKey: configService.get<string>('JWT_PRIVATE_KEY'),
    signOptions: { 
      algorithm: 'RS256',
      expiresIn: '7d' 
    },
  }),
})
```

**Ventajas:**
- Clave privada solo en el servidor que firma
- Clave pública puede distribuirse para verificación
- Mejor para arquitecturas de microservicios

**Desventajas:**
- Más complejo de configurar
- Requiere generar par de claves RSA
- HS256 es suficiente para aplicaciones monolíticas

### 2. Rotación de Secret

Implementar rotación periódica de `JWT_SECRET`:

```typescript
// Ejemplo de rotación (implementar según necesidades)
const OLD_SECRET = process.env.JWT_SECRET_OLD;
const NEW_SECRET = process.env.JWT_SECRET;

// Validar con ambos secrets durante período de transición
```

### 3. Tokens de Corta Duración + Refresh Tokens

Implementar tokens de acceso cortos (15 min) + refresh tokens largos:

```typescript
// Access token: 15 minutos
const accessToken = jwtService.sign(payload, { expiresIn: '15m' });

// Refresh token: 7 días
const refreshToken = jwtService.sign({ userId: user.id }, { expiresIn: '7d' });
```

## ✅ Conclusión

**Los tokens JWT están implementados de forma segura:**

- ✅ Estructura correcta (header.payload.signature)
- ✅ Algoritmo seguro (HS256)
- ✅ Expiración definida (1 día / 7 días)
- ✅ Validación completa (firma, expiración, revocación)
- ✅ Payload seguro (sin datos sensibles)
- ✅ Campos estándar (jti, iat, exp)

**Cumple con los requisitos de seguridad de la lista de cotejo.** ✅

