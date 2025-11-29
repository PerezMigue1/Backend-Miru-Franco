# 📋 Lo que Falta Implementar - Lista de Cotejo Módulo Usuario

## 🔴 Crítico (Debe Implementarse)

### 1. ⚠️ Protección CSRF (Parcialmente Implementado)
**Del checklist**: "Revisar peticiones POST sensibles y confirmar presencia de token CSRF."

**Estado Actual**:
- ✅ Código existe: `CsrfGuard` y `CsrfMiddleware` creados
- ❌ **NO está siendo usado**: No hay endpoints protegidos con CSRF
- ❌ **NO está registrado globalmente**: El middleware no está en `AppModule`

**Qué Falta**:
- Registrar `CsrfMiddleware` globalmente en `AppModule`
- Aplicar `CsrfGuard` a endpoints POST/PUT/DELETE sensibles
- Crear endpoint `GET /api/csrf-token` para que el frontend obtenga el token
- Configurar sesiones (express-session) si se usa cookies para CSRF

**Archivos a modificar**:
- `src/app.module.ts` - Registrar middleware
- `src/usuarios/usuarios.controller.ts` - Aplicar guard
- `src/auth/auth.controller.ts` - Aplicar guard
- Crear endpoint para obtener token CSRF

---

### 2. ⚠️ Control de Acceso RBAC (Parcialmente Implementado)
**Del checklist**: "Intentar acceder a recurso admin con usuario estándar. Acceso debe ser denegado."

**Estado Actual**:
- ✅ Campo `rol` existe en modelo `Usuario` (default: "usuario")
- ✅ `RolesGuard` implementado
- ✅ Decorador `@Roles()` disponible
- ❌ **NO hay endpoints protegidos**: No se usa en ningún controlador
- ❌ **NO hay endpoints admin**: No existen rutas específicas para administradores

**Qué Falta**:
- Crear endpoints de administración (ej: listar usuarios, modificar roles, etc.)
- Aplicar `@Roles('admin')` y `@UseGuards(RolesGuard)` a endpoints admin
- Asegurar que `RolesGuard` esté disponible en los módulos necesarios

**Archivos a modificar**:
- Crear `src/admin/admin.controller.ts` (nuevo módulo)
- O agregar endpoints admin en `src/usuarios/usuarios.controller.ts`
- Aplicar guards en los endpoints

---

## 🟡 Importante (Recomendado)

### 3. ❌ Autenticación Multifactor (MFA)
**Del checklist**: "Activar MFA y probar login sin segundo factor. El acceso debe ser denegado."

**Estado Actual**:
- ❌ **NO implementado**

**Qué Falta**:
- Agregar campo `mfaEnabled: Boolean` al modelo `Usuario`
- Agregar campo `mfaSecret: String?` para almacenar secreto TOTP
- Instalar biblioteca `speakeasy` o `otplib` para TOTP
- Crear endpoints:
  - `POST /api/auth/mfa/setup` - Generar QR y activar MFA
  - `POST /api/auth/mfa/verify` - Verificar código MFA
  - `POST /api/auth/mfa/disable` - Desactivar MFA
- Modificar `login` en `usuarios.service.ts` para requerir código MFA si está habilitado
- Actualizar `jwt.strategy.ts` para verificar MFA en el login

**Archivos a crear/modificar**:
- `prisma/schema.prisma` - Agregar campos MFA
- `src/auth/mfa/` - Nuevo módulo (controller, service)
- `src/usuarios/usuarios.service.ts` - Modificar login
- Migración de base de datos

---

### 4. ⚠️ Validación de Respuestas de Pregunta Secreta Comunes
**Del checklist**: "Intentar adivinar respuestas comunes. Verificar uso de preguntas personalizadas o MFA como refuerzo."

**Estado Actual**:
- ✅ Preguntas personalizadas implementadas
- ❌ **NO hay validación** de respuestas comunes/débiles

**Qué Falta**:
- Crear lista de respuestas comunes a rechazar (ej: "123", "password", "admin", "test", etc.)
- Agregar validación en `crearUsuario` cuando se guarda `preguntaSeguridad.respuesta`
- Validar longitud mínima (ej: mínimo 3 caracteres)
- Rechazar respuestas que sean solo números o solo letras

**Archivos a modificar**:
- `src/common/utils/security.util.ts` - Agregar función `isCommonAnswer()`
- `src/usuarios/usuarios.service.ts` - Validar en `crearUsuario`

---

## 🟢 Verificación (Ya Implementado, Solo Verificar)

### ✅ Implementado Correctamente

1. **Validación de datos de entrada** ✅
   - `sanitizeInput()` y `containsSQLInjection()` implementados
   - Se usa en registro y login

2. **Verificación de correo electrónico** ✅
   - OTP implementado con expiración de 2 minutos
   - No se puede iniciar sesión sin confirmar

3. **Hash seguro de contraseñas** ✅
   - bcrypt con salt automático
   - Verificar en BD que no hay contraseñas en texto plano

4. **Requisitos de complejidad de contraseña** ✅
   - `IsStrongPassword()` validador implementado
   - Mínimo 8 caracteres, mayúscula, minúscula, número

5. **Enlace de recuperación con expiración** ✅
   - Token expira en 15 minutos
   - Implementado en `validarRespuestaSeguridad`

6. **Validación de usuario (no revela existencia)** ✅
   - Implementado en login y recuperación

7. **Limitación de intentos de recuperación** ✅
   - Rate limiting implementado (3 intentos/minuto)

8. **Bloqueo tras intentos fallidos** ✅
   - 5 intentos fallidos = bloqueo 15 minutos
   - Implementado en `SecurityService`

9. **Uso de HTTPS** ✅
   - Render maneja HTTPS automáticamente
   - Verificar con SSL Labs

10. **Sesiones expiradas por inactividad** ✅
    - Implementado en `jwt.strategy.ts`
    - Verifica `lastActivity` con timeout de 15 minutos

11. **Revocación de sesiones activas** ✅
    - `logout()` revoca tokens
    - `jwt.strategy.ts` verifica blacklist
    - Token se invalida inmediatamente al cerrar sesión

12. **Tokens JWT seguros** ✅
    - HS256, expiración 7 días
    - Verificar estructura con jwt.io

13. **OAuth2.0 seguro** ✅
    - Implementado con Google
    - Tokens no en URLs ni logs

14. **Uso de salts en el hash** ✅
    - bcrypt genera salt automáticamente

15. **Política de longitud mínima** ✅
    - Mínimo 8 caracteres validado

16. **Protección contra XSS** ✅
    - `sanitizeInput()` implementado

17. **Protección contra inyecciones SQL** ✅
    - `containsSQLInjection()` implementado
    - Prisma previene SQL injection

18. **Uso de cabeceras de seguridad HTTP** ✅
    - Implementado en `main.ts`
    - CSP, HSTS, X-Frame-Options, etc.

19. **Logging seguro** ✅
    - `sanitizeForLogging()` implementado
    - No se registran contraseñas ni tokens completos

20. **Validación de tokens de sesión al cerrar sesión** ✅
    - Tokens se revocan inmediatamente

---

## 📊 Resumen por Prioridad

### 🔴 Crítico - Implementar Pronto
1. **CSRF Protection** - Activar guards y middleware existentes
2. **RBAC** - Crear endpoints admin y aplicar guards

### 🟡 Importante - Implementar Después
3. **MFA** - Requiere nueva funcionalidad completa
4. **Validación de respuestas comunes** - Validación simple

### 🟢 Solo Verificar
- Todo lo demás está implementado ✅

---

## 🚀 Plan de Acción Recomendado

### Fase 1: Activar Funcionalidad Existente (1-2 horas)
1. Registrar `CsrfMiddleware` en `AppModule`
2. Aplicar `CsrfGuard` a endpoints sensibles
3. Crear endpoint para obtener token CSRF
4. Crear 1-2 endpoints admin de ejemplo
5. Aplicar `@Roles('admin')` a endpoints admin

### Fase 2: Validación de Respuestas (30 min)
1. Crear función `isCommonAnswer()`
2. Agregar validación en `crearUsuario`

### Fase 3: MFA (4-6 horas)
1. Agregar campos MFA al schema
2. Crear migración
3. Instalar `speakeasy`
4. Crear módulo MFA
5. Integrar con login

---

## 📝 Notas Adicionales

- **Contraseñas en tránsito cifradas**: Requiere HTTPS (ya implementado en producción)
- **Revisión de dependencias**: Ejecutar `npm audit` periódicamente
- **Pruebas de vulnerabilidades**: Usar OWASP ZAP o Burp Suite
- **Evaluación de cookies**: Actualmente se usan tokens en headers, no cookies. Si se implementan cookies en el futuro, deben tener `HttpOnly`, `Secure`, `SameSite`.

