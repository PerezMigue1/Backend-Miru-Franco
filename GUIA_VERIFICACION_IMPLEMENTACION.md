# 🔍 Guía de Verificación - Cómo Revisar que Está Implementado

Esta guía te muestra paso a paso cómo verificar que cada elemento de la lista de cotejo está funcionando correctamente.

---

## 📋 1. Registro de Usuario

### ✅ Validación de datos de entrada

**Cómo verificar:**

1. **Usar Postman o curl:**
   ```bash
   POST http://localhost:3000/api/usuarios/registrar
   Content-Type: application/json
   
   {
     "nombre": "<script>alert('XSS')</script>",
     "email": "test@test.com",
     "password": "Password123",
     ...
   }
   ```

2. **Probar SQL Injection:**
   ```json
   {
     "email": "test@test.com' OR '1'='1",
     "password": "Password123"
   }
   ```

3. **Resultado esperado:**
   - Debe rechazar con error 400
   - Mensaje: "Datos inválidos" o similar
   - NO debe ejecutar el script ni la inyección SQL

**Verificar en código:**
```bash
# Buscar en el código
grep -r "sanitizeInput" src/
grep -r "containsSQLInjection" src/
```

---

### ✅ Verificación de correo electrónico

**Cómo verificar:**

1. **Registrar un usuario nuevo:**
   ```bash
   POST /api/usuarios/registrar
   {
     "email": "nuevo@test.com",
     ...
   }
   ```

2. **Intentar iniciar sesión SIN verificar correo:**
   ```bash
   POST /api/usuarios/login
   {
     "email": "nuevo@test.com",
     "password": "Password123"
   }
   ```

3. **Resultado esperado:**
   - Error 401 o 403
   - Mensaje indicando que debe verificar el correo
   - NO debe permitir login

4. **Verificar correo con OTP:**
   ```bash
   POST /api/usuarios/verificar-correo
   {
     "email": "nuevo@test.com",
     "codigoOTP": "123456"
   }
   ```

5. **Ahora intentar login:**
   - Debe funcionar correctamente

**Verificar en base de datos:**
```sql
SELECT email, confirmado, codigoOTP FROM usuarios WHERE email = 'nuevo@test.com';
-- confirmado debe ser false antes de verificar
```

---

### ✅ Hash seguro de contraseñas

**Cómo verificar:**

1. **Registrar un usuario:**
   ```bash
   POST /api/usuarios/registrar
   {
     "email": "test@test.com",
     "password": "Password123",
     ...
   }
   ```

2. **Revisar en base de datos:**
   ```sql
   SELECT email, password FROM usuarios WHERE email = 'test@test.com';
   ```

3. **Resultado esperado:**
   - El campo `password` debe empezar con `$2b$` o `$2a$` (formato bcrypt)
   - NO debe ser "Password123" en texto plano
   - Debe tener ~60 caracteres

4. **Verificar en código:**
   ```bash
   grep -r "bcrypt.hash" src/
   # Debe encontrar: await bcrypt.hash(password, 10)
   ```

---

### ✅ Requisitos de complejidad de contraseña

**Cómo verificar:**

1. **Intentar registrar con contraseña débil:**
   ```bash
   POST /api/usuarios/registrar
   {
     "email": "test@test.com",
     "password": "123456",  # ❌ Muy simple
     ...
   }
   ```

2. **Resultado esperado:**
   - Error 400
   - Mensaje: "La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, una minúscula y un número"

3. **Probar otras contraseñas débiles:**
   - `"password"` → ❌ Falta mayúscula y número
   - `"PASSWORD"` → ❌ Falta minúscula y número
   - `"Password"` → ❌ Falta número
   - `"Password1"` → ✅ Debe funcionar

**Verificar en código:**
```bash
cat src/common/validators/password.validator.ts
```

---

## 📋 2. Recuperación de Contraseña

### ✅ Enlace de recuperación con expiración

**Cómo verificar:**

1. **Solicitar recuperación:**
   ```bash
   POST /api/usuarios/obtener-pregunta
   {
     "email": "test@test.com"
   }
   ```

2. **Verificar respuesta y obtener token:**
   ```bash
   POST /api/usuarios/verificar-respuesta
   {
     "email": "test@test.com",
     "respuesta": "respuesta_correcta"
   }
   ```

3. **Revisar en base de datos:**
   ```sql
   SELECT resetPasswordToken, resetPasswordExpires 
   FROM usuarios 
   WHERE email = 'test@test.com';
   ```

4. **Esperar 16 minutos y usar el token:**
   ```bash
   POST /api/usuarios/cambiar-password
   {
     "email": "test@test.com",
     "token": "token_obtenido",
     "nuevaPassword": "NewPassword123"
   }
   ```

5. **Resultado esperado:**
   - Después de 15 minutos: Error indicando que el token expiró
   - Antes de 15 minutos: Debe funcionar

**Verificar en código:**
```bash
grep -r "resetPasswordExpires" src/
# Debe encontrar: new Date(Date.now() + 15 * 60 * 1000)
```

---

### ✅ Validación de usuario (no revela existencia)

**Cómo verificar:**

1. **Intentar recuperación con email inexistente:**
   ```bash
   POST /api/usuarios/obtener-pregunta
   {
     "email": "noexiste@test.com"
   }
   ```

2. **Resultado esperado:**
   - Debe responder con éxito (200) o error genérico
   - NO debe decir "Usuario no encontrado"
   - Debe dar el mismo tiempo de respuesta que un email válido

3. **Comparar con email válido:**
   - Ambos deben tener tiempos de respuesta similares
   - Ambos deben dar respuestas similares

**Verificar en código:**
```bash
grep -r "obtenerPreguntaSeguridad" src/
# Verificar que no revele si el usuario existe
```

---

### ✅ Limitación de intentos de recuperación

**Cómo verificar:**

1. **Hacer 4 solicitudes rápidas:**
   ```bash
   # Ejecutar 4 veces rápidamente
   POST /api/usuarios/obtener-pregunta
   {
     "email": "test@test.com"
   }
   ```

2. **Resultado esperado:**
   - Las primeras 3 deben funcionar
   - La 4ta debe dar error 429 (Too Many Requests)
   - Mensaje indicando rate limit

**Verificar en código:**
```bash
grep -r "rate-limit" src/
grep -r "RateLimitGuard" src/
```

---

## 📋 3. Inicio de Sesión

### ✅ Bloqueo tras intentos fallidos (fuerza bruta)

**Cómo verificar:**

1. **Intentar login 6 veces con contraseña incorrecta:**
   ```bash
   # Ejecutar 6 veces
   POST /api/usuarios/login
   {
     "email": "test@test.com",
     "password": "PasswordIncorrecta"
   }
   ```

2. **Resultado esperado:**
   - Intentos 1-4: Error 401 "Credenciales inválidas"
   - Intento 5: Error 401
   - Intento 6: Error 403 "Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en X minutos"

3. **Verificar en base de datos:**
   ```sql
   SELECT intentosLoginFallidos, cuentaBloqueadaHasta 
   FROM usuarios 
   WHERE email = 'test@test.com';
   ```

4. **Intentar login con contraseña correcta mientras está bloqueado:**
   - Debe seguir dando error de bloqueo

5. **Esperar 15 minutos y volver a intentar:**
   - Debe funcionar normalmente

**Verificar en código:**
```bash
grep -r "recordFailedLoginAttempt" src/
grep -r "isAccountLocked" src/
```

---

### ✅ Uso de HTTPS

**Cómo verificar:**

1. **Verificar en producción:**
   - Abrir: `https://tu-dominio.com/api/auth/test`
   - El navegador debe mostrar candado verde
   - NO debe permitir `http://` (sin 's')

2. **Verificar con SSL Labs:**
   - Ir a: https://www.ssllabs.com/ssltest/
   - Ingresar tu dominio
   - Debe dar calificación A o A-

3. **Verificar headers:**
   ```bash
   curl -I https://tu-dominio.com/api/auth/test
   # Debe incluir: Strict-Transport-Security
   ```

---

### ✅ Sesiones expiradas por inactividad

**Cómo verificar:**

1. **Iniciar sesión:**
   ```bash
   POST /api/usuarios/login
   {
     "email": "test@test.com",
     "password": "Password123"
   }
   # Guardar el token
   ```

2. **Usar el token inmediatamente:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token>
   # Debe funcionar
   ```

3. **Modificar el token para simular inactividad:**
   - Ir a https://jwt.io
   - Decodificar el token
   - Modificar `lastActivity` a hace 16 minutos
   - Intentar usar el token modificado

4. **O esperar 16 minutos sin hacer peticiones:**
   ```bash
   # Después de 16 minutos
   GET /api/auth/me
   Authorization: Bearer <token>
   ```

5. **Resultado esperado:**
   - Error 401 "Sesión expirada por inactividad"

**Verificar en código:**
```bash
cat src/auth/strategies/jwt.strategy.ts
# Buscar: INACTIVITY_TIMEOUT = 15 * 60
```

---

### ✅ Revocación de sesiones activas

**Cómo verificar:**

1. **Iniciar sesión en "dispositivo 1":**
   ```bash
   POST /api/usuarios/login
   {
     "email": "test@test.com",
     "password": "Password123"
   }
   # Guardar token1
   ```

2. **Iniciar sesión en "dispositivo 2" (mismo usuario):**
   ```bash
   POST /api/usuarios/login
   {
     "email": "test@test.com",
     "password": "Password123"
   }
   # Guardar token2
   ```

3. **Usar token1:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token1>
   # Debe funcionar
   ```

4. **Cerrar sesión con token1:**
   ```bash
   POST /api/auth/logout
   Authorization: Bearer <token1>
   ```

5. **Intentar usar token1 después de logout:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token1>
   # Debe dar error 401 "Token revocado"
   ```

6. **Verificar que token2 sigue funcionando:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token2>
   # Debe funcionar (si quieres invalidar todos, necesitas implementar logout global)
   ```

**Verificar en base de datos:**
```sql
SELECT * FROM tokens_revocados;
# Debe tener el token revocado
```

---

### ✅ Tokens JWT seguros

**Cómo verificar:**

1. **Obtener un token:**
   ```bash
   POST /api/usuarios/login
   {
     "email": "test@test.com",
     "password": "Password123"
   }
   ```

2. **Decodificar en jwt.io:**
   - Ir a: https://jwt.io
   - Pegar el token
   - Verificar estructura: `header.payload.signature`

3. **Verificar header:**
   ```json
   {
     "alg": "HS256",
     "typ": "JWT"
   }
   ```

4. **Verificar payload:**
   - Debe tener: `id`, `email`, `exp`, `iat`
   - `exp` debe ser futuro (7 días desde ahora)

**Verificar en código:**
```bash
grep -r "JWT_SECRET" src/
grep -r "expiresIn" src/
```

---

### ✅ OAuth2.0 seguro

**Cómo verificar:**

1. **Revisar logs del servidor:**
   ```bash
   # Buscar en logs
   grep -i "token" logs/*.log
   # NO debe aparecer tokens completos
   ```

2. **Probar flujo OAuth:**
   - Ir a: `/api/auth/google`
   - Debe redirigir a Google
   - Después de autenticar, debe redirigir de vuelta
   - El token NO debe aparecer en la URL

3. **Verificar en código:**
   ```bash
   grep -r "googleLogin" src/
   # Verificar que token no se expone en URL
   ```

---

## 📋 4. Contraseñas

### ✅ Uso de salts en el hash

**Cómo verificar:**

1. **Registrar dos usuarios con la misma contraseña:**
   ```bash
   # Usuario 1
   POST /api/usuarios/registrar
   { "email": "user1@test.com", "password": "Password123", ... }
   
   # Usuario 2
   POST /api/usuarios/registrar
   { "email": "user2@test.com", "password": "Password123", ... }
   ```

2. **Revisar en base de datos:**
   ```sql
   SELECT email, password FROM usuarios 
   WHERE email IN ('user1@test.com', 'user2@test.com');
   ```

3. **Resultado esperado:**
   - Los hashes deben ser DIFERENTES (bcrypt genera salt único)
   - Ambos deben empezar con `$2b$` o `$2a$`

**Verificar en código:**
```bash
grep -r "bcrypt.hash" src/
# bcrypt automáticamente genera salt único
```

---

### ✅ Política de longitud mínima

**Cómo verificar:**

1. **Intentar cambiar contraseña a una corta:**
   ```bash
   POST /api/usuarios/cambiar-password
   {
     "email": "test@test.com",
     "token": "token_valido",
     "nuevaPassword": "Pass1"  # Solo 5 caracteres
   }
   ```

2. **Resultado esperado:**
   - Error 400
   - Mensaje: "La contraseña debe tener al menos 8 caracteres"

**Verificar en código:**
```bash
grep -r "@MinLength(8" src/
```

---

### ✅ Contraseñas en tránsito cifradas

**Cómo verificar:**

1. **Verificar que se usa HTTPS:**
   - Todas las peticiones deben ser `https://`
   - NO usar `http://` en producción

2. **Usar Wireshark (avanzado):**
   - Capturar tráfico de red
   - Filtrar por `tls` o `ssl`
   - Verificar que las peticiones están cifradas

3. **Verificar en navegador:**
   - Abrir DevTools → Network
   - Hacer login
   - Verificar que la petición es HTTPS
   - Verificar que el payload está cifrado

---

## 📋 5. Desarrollo Seguro

### ✅ Protección contra XSS

**Cómo verificar:**

1. **Intentar registrar con script:**
   ```bash
   POST /api/usuarios/registrar
   {
     "nombre": "<script>alert('XSS')</script>",
     "email": "test@test.com",
     ...
   }
   ```

2. **Obtener el usuario:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token>
   ```

3. **Resultado esperado:**
   - El nombre debe estar sanitizado
   - NO debe contener `<script>`
   - Si se muestra en frontend, NO debe ejecutarse

**Verificar en código:**
```bash
grep -r "sanitizeInput" src/
```

---

### ✅ Protección contra inyecciones SQL

**Cómo verificar:**

1. **Intentar SQL injection en login:**
   ```bash
   POST /api/usuarios/login
   {
     "email": "test@test.com' OR '1'='1",
     "password": "cualquiercosa"
   }
   ```

2. **Resultado esperado:**
   - Error 401 "Credenciales inválidas"
   - NO debe ejecutar SQL
   - NO debe dar error de base de datos

3. **Revisar logs del servidor:**
   - NO debe aparecer error SQL
   - Puede aparecer warning de intento de SQL injection

**Verificar en código:**
```bash
grep -r "containsSQLInjection" src/
```

---

### ✅ Uso de cabeceras de seguridad HTTP

**Cómo verificar:**

1. **Hacer petición y revisar headers:**
   ```bash
   curl -I https://tu-dominio.com/api/auth/test
   ```

2. **Resultado esperado - Debe incluir:**
   ```
   X-Content-Type-Options: nosniff
   X-Frame-Options: DENY
   X-XSS-Protection: 1; mode=block
   Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
   Content-Security-Policy: default-src 'self'; ...
   Referrer-Policy: strict-origin-when-cross-origin
   ```

3. **Verificar con SecurityHeaders.com:**
   - Ir a: https://securityheaders.com
   - Ingresar tu dominio
   - Debe dar calificación A o A+

**Verificar en código:**
```bash
cat src/main.ts
# Buscar sección de headers de seguridad
```

---

### ✅ Logging seguro

**Cómo verificar:**

1. **Hacer varias operaciones:**
   - Registrar usuario
   - Iniciar sesión
   - Cambiar contraseña

2. **Revisar logs del servidor:**
   ```bash
   # Buscar en logs
   grep -i "password" logs/*.log
   grep -i "token" logs/*.log
   ```

3. **Resultado esperado:**
   - NO debe aparecer contraseñas en texto plano
   - NO debe aparecer tokens completos
   - Debe aparecer `***REDACTED***` o similar

**Verificar en código:**
```bash
grep -r "sanitizeForLogging" src/
```

---

### ✅ Validación de tokens de sesión al cerrar sesión

**Cómo verificar:**

1. **Iniciar sesión:**
   ```bash
   POST /api/usuarios/login
   # Guardar token
   ```

2. **Usar el token:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token>
   # Debe funcionar
   ```

3. **Cerrar sesión:**
   ```bash
   POST /api/auth/logout
   Authorization: Bearer <token>
   ```

4. **Intentar usar el token después de logout:**
   ```bash
   GET /api/auth/me
   Authorization: Bearer <token>
   # Debe dar error 401 "Token revocado"
   ```

5. **Verificar en base de datos:**
   ```sql
   SELECT * FROM tokens_revocados WHERE token = '<token>';
   # Debe existir el registro
   ```

---

## 🟢 Verificaciones Manuales (Solo Verificar)

### Revisión de dependencias seguras

```bash
npm audit
# Debe mostrar vulnerabilidades si las hay
# Corregir con: npm audit fix
```

### Análisis de dependencias vulnerables

```bash
# Usar Snyk (requiere cuenta)
npx snyk test

# O usar npm audit
npm audit --audit-level=moderate
```

### Pruebas de configuración HTTPS/TLS

1. Ir a: https://www.ssllabs.com/ssltest/
2. Ingresar tu dominio
3. Debe dar calificación A o A-
4. TLS 1.2 o superior debe estar habilitado

### Evaluación de cookies

1. Abrir DevTools → Application → Cookies
2. Si hay cookies, verificar que tengan:
   - `HttpOnly: true`
   - `Secure: true`
   - `SameSite: Strict` o `Lax`

**Nota:** Actualmente el proyecto usa tokens en headers, no cookies.

---

## 📝 Checklist Rápido

Usa este checklist para verificar rápidamente:

- [ ] Validación rechaza `<script>` y SQL injection
- [ ] No se puede login sin verificar correo
- [ ] Contraseñas en BD están hasheadas (empiezan con `$2b$`)
- [ ] Contraseñas débiles son rechazadas
- [ ] Tokens de recuperación expiran después de 15 min
- [ ] Recuperación no revela si usuario existe
- [ ] Rate limiting funciona en recuperación
- [ ] Cuenta se bloquea después de 5 intentos fallidos
- [ ] HTTPS está habilitado en producción
- [ ] Sesión expira después de 15 min de inactividad
- [ ] Token se invalida al cerrar sesión
- [ ] JWT tiene estructura correcta (header.payload.signature)
- [ ] Headers de seguridad están presentes
- [ ] Logs no contienen contraseñas ni tokens
- [ ] XSS está sanitizado
- [ ] SQL injection es rechazado

---

## 🛠️ Herramientas Útiles

- **Postman**: Para probar endpoints manualmente
- **curl**: Para peticiones desde terminal
- **jwt.io**: Para decodificar tokens JWT
- **SSL Labs**: Para verificar HTTPS/TLS
- **SecurityHeaders.com**: Para verificar headers de seguridad
- **OWASP ZAP**: Para escaneo automático de vulnerabilidades
- **npm audit**: Para revisar dependencias vulnerables

