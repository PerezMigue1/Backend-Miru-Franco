# 🔍 Guía de Verificación - Cómo Revisar que Está Implementado

Esta guía te muestra paso a paso cómo verificar que cada elemento de la lista de cotejo está funcionando correctamente.

## 📝 Nota sobre Rutas y URLs

### Rutas Disponibles para Registro

**Todas estas rutas funcionan:**
- `POST /api/usuarios` (ruta base)
- `POST /api/usuarios/registrar` (ruta principal)
- `POST /api/usuarios/registro` (alias - agregada para compatibilidad)

Todas hacen lo mismo. Usa la que tengas configurada en tu frontend.

### URLs según Entorno

**Desarrollo Local:**
- Backend: `http://localhost:3001` (puerto configurable en `.env`)
- Frontend: `http://localhost:3000`

**Producción:**
- Backend: `https://api.mirufranco.com` (servicio en Render con dominio propio)
- Frontend: `https://www.mirufranco.com` (proyecto en Vercel con dominio propio)

**Rutas del Frontend (páginas que ve el usuario):**
- `/login` - Página de inicio de sesión
- `/register` - Página de registro
- `/forgot-password` - Página de recuperación de contraseña

**Nota:** Vercel también genera una URL `*.vercel.app` por cada deployment (previews). Esas URLs no sirven para probar el inicio de sesión: la cookie `mf_session` es de `api.mirufranco.com` con `SameSite=Strict` y CORS solo admite los orígenes de producción y los listados en `CORS_ALLOWED_ORIGINS`. Las pruebas de esta guía se hacen sobre `https://www.mirufranco.com`.

**⚠️ Importante:**
- El **frontend** (Vercel) es donde el usuario ve la página web
- El **backend** (Render) es donde se hacen las peticiones API
- El frontend hace peticiones HTTP al backend

**Ejemplo de configuración en el Frontend:**
```typescript
// En desarrollo
const API_URL = 'http://localhost:3001';

// En producción
const API_URL = 'https://api.mirufranco.com';

// Usar en peticiones desde el frontend
fetch(`${API_URL}/api/usuarios/registro`, { ... });
```

**Flujo de petición:**
```
Usuario visita: https://www.mirufranco.com/register
    ↓
Frontend (Vercel) hace petición HTTP a: 
    https://api.mirufranco.com/api/usuarios/registro
    ↓
Backend (Render) procesa la petición y responde
    ↓
Frontend recibe respuesta y muestra resultado al usuario
```

**Ejemplo real desde tu frontend:**
```typescript
// En tu código del frontend (Vercel)
const API_URL = 'https://api.mirufranco.com';

// Cuando el usuario está en: https://www.mirufranco.com/register
// Y hace submit del formulario, el frontend hace:
fetch(`${API_URL}/api/usuarios/registro`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(formData),
});
```

**Rutas del Frontend vs Endpoints del Backend:**
- Frontend `/register` → Backend `POST /api/usuarios/registro`
- Frontend `/login` → Backend `POST /api/usuarios/login`
- Frontend `/forgot-password` → Backend `POST /api/usuarios/pregunta-seguridad`

---

## 🌐 Verificación desde Frontend Desplegado

### URLs Reales de tu Aplicación

**Frontend (Vercel):**
- Base URL: `https://www.mirufranco.com`
- Login: `https://www.mirufranco.com/login`
- Registro: `https://www.mirufranco.com/register`
- Recuperación: `https://www.mirufranco.com/forgot-password`

**Backend (Render):**
- API Base: `https://api.mirufranco.com/api`

### Mapeo de Rutas Frontend → Backend

| Página Frontend | Endpoint Backend | Método | Descripción |
|----------------|------------------|--------|-------------|
| `/register` | `/api/usuarios/registro` | POST | Registrar nuevo usuario |
| `/login` | `/api/usuarios/login` | POST | Iniciar sesión |
| `/forgot-password` | `/api/usuarios/pregunta-seguridad` | POST | Obtener pregunta de seguridad |
| Verificación respuesta | `/api/usuarios/verificar-respuesta` | POST | Verificar respuesta y obtener token |
| Cambiar contraseña | `/api/usuarios/cambiar-password` | POST | Cambiar contraseña con token |
| Verificación OTP | `/api/usuarios/verificar-otp` | POST | Verificar código OTP |
| Reenviar código | `/api/usuarios/reenviar-codigo` | POST | Reenviar código OTP |

### Cómo Verificar desde el Frontend

**1. Abrir DevTools (F12) → Network Tab**

**2. Visitar la página que quieres probar:**
```
https://www.mirufranco.com/register
https://www.mirufranco.com/login
https://www.mirufranco.com/forgot-password
```

**3. Realizar la acción (llenar formulario, hacer submit, etc.)**

**4. En Network Tab, verificar la petición:**
- Debe aparecer: `POST https://api.mirufranco.com/api/usuarios/...`
- Status: 200/201 (éxito) o 400/401/403 (error)
- Verificar que la petición va al backend correcto

**5. Verificar respuesta:**
- Si es exitosa: Verificar que el frontend maneja correctamente la respuesta
- Si hay error: Verificar que el mensaje de error se muestra correctamente

### Ejemplo: Verificar Registro desde Frontend

**Pasos:**
1. Abrir: `https://www.mirufranco.com/register`
2. Abrir DevTools → Network Tab
3. Llenar formulario de registro
4. Hacer submit
5. En Network Tab, buscar la petición:
   - **URL:** `https://api.mirufranco.com/api/usuarios/registro`
   - **Método:** POST
   - **Status:** 201 (éxito) o 400 (error de validación)
6. Verificar respuesta en la pestaña "Response"

---

## 📋 1. Registro de Usuario

### ✅ Validación de datos de entrada

**Cómo verificar:**

1. **Usar Postman o curl:**

   **Desarrollo Local:**
   ```bash
   POST http://localhost:3001/api/usuarios/registro
   # O también: POST http://localhost:3001/api/usuarios/registrar
   Content-Type: application/json
   
   {
     "nombre": "<script>alert('XSS')</script>",
     "email": "test@test.com",
     "password": "Password123",
     ...
   }
   ```

   **Producción:**
   ```bash
   POST https://api.mirufranco.com/api/usuarios/registro
   # O también: POST https://api.mirufranco.com/api/usuarios/registrar
   Content-Type: application/json
   
   {
     "nombre": "<script>alert('XSS')</script>",
     "email": "test@test.com",
     "password": "Password123",
     ...
   }
   ```

2. **Probar SQL Injection:**

   **Opción A: Usando Postman**
   - Crear petición POST a: `https://api.mirufranco.com/api/usuarios/login`
   - Body (JSON):
   ```json
   {
     "email": "test@test.com' OR '1'='1",
     "password": "Password123"
   }
   ```
   - Enviar y verificar respuesta

   **Opción B: Desde el Frontend**
   - Visitar: `https://www.mirufranco.com/login`
   - En el campo email escribir: `test@test.com' OR '1'='1`
   - Intentar login
   - Abrir DevTools → Network para ver la respuesta

   **Opción C: Usando curl**
   ```bash
   curl -X POST https://api.mirufranco.com/api/usuarios/login \
     -H "Content-Type: application/json" \
     -d '{"email": "test@test.com'\'' OR '\''1'\''='\''1", "password": "Password123"}'
   ```

3. **Resultado esperado:**
   - Debe rechazar con error **401** (login) o **400** (registro)
   - Mensaje: "Credenciales inválidas" o "Datos inválidos"
   - **NO debe ejecutar** el SQL
   - **NO debe dar** error de base de datos
   - Si la protección funciona, verás error 401/400, no un error SQL

   **⚠️ Si ves error SQL en la respuesta, hay un problema de seguridad**

   **Ver guía completa:** `GUIA_PRUEBA_SQL_INJECTION.md`

**Verificar en código:**
```bash
# Buscar en el código
grep -r "sanitizeInput" src/
grep -r "containsSQLInjection" src/
```

---

### ✅ Verificación de correo electrónico

**Cómo verificar desde el Frontend:**

1. **Visitar página de registro:**
   ```
   https://www.mirufranco.com/register
   ```

2. **Registrar un usuario nuevo:**
   - Llenar formulario con email: `nuevo@test.com`
   - Hacer submit
   - Debe redirigir a página de verificación de correo

3. **Intentar iniciar sesión SIN verificar correo:**
   - Visitar: `https://www.mirufranco.com/login`
   - Intentar login con el usuario recién registrado
   - **Resultado esperado:** Debe mostrar error o redirigir a verificación

**Cómo verificar desde Postman/API:**

> 📖 **Guía detallada:** Ver `GUIA_PRUEBA_VERIFICACION_EMAIL_POSTMAN.md` para instrucciones paso a paso completas con ejemplos de JSON.

**Resumen rápido:**

1. **Registrar un usuario nuevo:**
   ```bash
   POST https://api.mirufranco.com/api/usuarios/registro
   Content-Type: application/json
   
   {
     "nombre": "Usuario Test",
     "email": "nuevo@test.com",
     "telefono": "5551234567",
     "password": "Password123",
     "fechaNacimiento": "1990-01-15",
     "preguntaSeguridad": {
       "pregunta": "¿Cuál es el nombre de tu primera mascota?",
       "respuesta": "Fido"
     },
     "direccion": {
       "calle": "Calle Principal",
       "numero": "123",
       "colonia": "Centro",
       "ciudad": "Ciudad de México",
       "estado": "CDMX",
       "codigoPostal": "01000"
     },
     "perfilCapilar": {
       "tipoCabello": "liso",
       "colorNatural": "Negro",
       "colorActual": "Negro",
       "tieneAlergias": false
     },
     "aceptaAvisoPrivacidad": true
   }
   ```
   **Resultado esperado:** 
   - Status 201
   - `{ "success": true, "message": "Ingresa el código para activar tu cuenta...", "requiereVerificacion": true }`
   - Revisar email para obtener código OTP

2. **Intentar iniciar sesión SIN verificar correo:**
   ```bash
   POST https://api.mirufranco.com/api/usuarios/login
   Content-Type: application/json
   
   {
     "email": "nuevo@test.com",
     "password": "Password123"
   }
   ```

3. **Resultado esperado:**
   - Error 401 Unauthorized
   - Mensaje: `"Debes verificar tu correo electrónico antes de iniciar sesión"`
   - NO debe permitir login (no debe devolver token)

4. **Verificar correo con OTP:**
   ```bash
   POST https://api.mirufranco.com/api/usuarios/verificar-otp
   Content-Type: application/json
   
   {
     "email": "nuevo@test.com",
     "codigoOTP": "123456"
   }
   ```
   **Nota:** Reemplaza `123456` con el código real recibido por email.

5. **Intentar login DESPUÉS de verificar:**
   ```bash
   POST https://api.mirufranco.com/api/usuarios/login
   Content-Type: application/json
   
   {
     "email": "nuevo@test.com",
     "password": "Password123"
   }
   ```
   **Resultado esperado:**
   - Status 200 OK
   - Debe devolver token JWT
   - Login exitoso

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
   # O también: POST /api/usuarios/registro
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

**Cómo verificar desde el Frontend:**

1. **Visitar página de recuperación:**
   ```
   https://www.mirufranco.com/forgot-password
   ```

2. **Solicitar recuperación:**
   - Ingresar email: `test@test.com`
   - Hacer submit
   - Debe mostrar la pregunta de seguridad

3. **Responder pregunta y obtener token:**
   - Ingresar respuesta correcta
   - Debe mostrar formulario para nueva contraseña
   - **Nota:** El token expira en 15 minutos

4. **Esperar 16 minutos y intentar cambiar contraseña:**
   - Debe mostrar error de token expirado

**Cómo verificar desde Postman/API:**

1. **Solicitar recuperación:**
   ```bash
   POST https://api.mirufranco.com/api/usuarios/pregunta-seguridad
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

**Cómo verificar desde el Frontend:**

1. **Visitar página de login:**
   ```
   https://www.mirufranco.com/login
   ```

2. **Intentar login 6 veces con contraseña incorrecta:**
   - Usar email válido: `test@test.com`
   - Usar contraseña incorrecta
   - Hacer submit 6 veces seguidas

3. **Resultado esperado:**
   - Intentos 1-5: Error "Credenciales inválidas"
   - Intento 6: Error "Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en X minutos"

**Cómo verificar desde Postman/API:**

1. **Intentar login 6 veces con contraseña incorrecta:**
   ```bash
   # Ejecutar 6 veces
   POST https://api.mirufranco.com/api/usuarios/login
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
   - `exp` debe ser futuro (24 horas desde la emisión, ver `src/auth/jwt-ttl.ts`)

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
   # O también: POST /api/usuarios/registro
   { "email": "user1@test.com", "password": "Password123", ... }
   
   # Usuario 2
   POST /api/usuarios/registrar
   # O también: POST /api/usuarios/registro
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
   # O también: POST /api/usuarios/registro
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

