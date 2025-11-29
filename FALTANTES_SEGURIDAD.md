# ❌ Lo que Falta Implementar de la Lista de Cotejo

## 🔴 Crítico (Debe Implementarse)

### 1. ❌ Revocación de Sesiones Activas
**Del checklist**: "Iniciar sesión en varios dispositivos. Cerrar sesión en uno y comprobar que el token se invalida en el otro."

**Estado**: 
- ✅ Código preparado (`TokenRevocado` modelo, `SecurityService.revokeToken()`)
- ❌ **FALTA**: Integrar en endpoint de logout
- ❌ **FALTA**: Verificar blacklist en cada petición autenticada

**Qué hacer**:
- Crear endpoint `POST /api/auth/logout` que revoque el token
- Agregar middleware/guard que verifique blacklist antes de validar JWT

---

### 2. ❌ Protección CSRF
**Del checklist**: "Revisar peticiones POST sensibles y confirmar presencia de token CSRF."

**Estado**: ❌ **NO implementado**

**Qué hacer**:
- Instalar `csurf` o implementar tokens CSRF personalizados
- Agregar middleware CSRF para endpoints POST/PUT/DELETE
- Frontend debe incluir token CSRF en headers

---

### 3. ❌ Sesiones Expiradas por Inactividad
**Del checklist**: "Iniciar sesión y esperar periodo inactivo (>15 min). El sistema debe cerrar sesión automáticamente."

**Estado**: 
- ✅ JWT expira en 1 día (expiración fija)
- ❌ **FALTA**: Verificación de inactividad (última petición > 15 min)

**Qué hacer**:
- Agregar campo `ultimaActividad` en JWT payload
- Guard que verifique tiempo desde última actividad
- Renovar token automáticamente si hay actividad

---

## 🟡 Importante (Recomendado)

### 4. ❌ Autenticación Multifactor (MFA)
**Del checklist**: "Activar MFA y probar login sin segundo factor. El acceso debe ser denegado."

**Estado**: ❌ **NO implementado**

**Qué hacer**:
- Agregar campo `mfaEnabled` en modelo Usuario
- Implementar TOTP (Time-based One-Time Password) con biblioteca como `speakeasy`
- Endpoint para generar QR code y activar MFA
- Modificar login para requerir código MFA si está habilitado

---

### 5. ⚠️ Validación de Respuestas de Pregunta Secreta Comunes
**Del checklist**: "Intentar adivinar respuestas comunes. Verificar uso de preguntas personalizadas o MFA como refuerzo."

**Estado**: 
- ✅ Preguntas personalizadas implementadas
- ⚠️ **FALTA**: Validar que respuestas no sean muy comunes (ej: "123", "password", etc.)

**Qué hacer**:
- Lista de respuestas comunes a rechazar
- Validación adicional al guardar respuesta de seguridad

---

### 6. ❌ Control de Acceso (RBAC)
**Del checklist**: "Intentar acceder a recurso admin con usuario estándar. Acceso debe ser denegado."

**Estado**: ❌ **NO implementado** (no hay roles/permisos)

**Qué hacer**:
- Agregar campo `rol` al modelo Usuario (ej: 'usuario', 'admin')
- Guard para verificar roles en endpoints admin
- Endpoints específicos para administradores

---

## 🟢 Verificación (Ya Existe, Solo Verificar)

### 7. ✅ Verificación de Correo Electrónico
**Del checklist**: "No debería poder iniciar sesión sin validar el correo."

**Estado**: ✅ **Implementado** (verificación con OTP)
**Acción**: Solo verificar que funciona correctamente

---

### 8. ✅ Hash Seguro de Contraseñas
**Del checklist**: "Revisar base de datos y confirmar que no existan contraseñas en texto plano. Validar uso de bcrypt/Argon2."

**Estado**: ✅ **Implementado** (bcrypt con salt automático)
**Acción**: Verificar en base de datos que contraseñas están hasheadas

---

### 9. ✅ Uso de HTTPS
**Del checklist**: "Revisar que todas las URLs de autenticación usen HTTPS y que el certificado sea válido."

**Estado**: ✅ Render maneja HTTPS automáticamente
**Acción**: Verificar con SSL Labs que certificado es válido

---

### 10. ✅ Tokens JWT Seguros
**Del checklist**: "Revisar estructura del token (header.payload.signature). Confirmar uso de RS256 o HS256 y expiración definida."

**Estado**: ✅ **Implementado** (HS256, expiración 1 día)
**Acción**: Solo verificar estructura con jwt.io

---

### 11. ✅ OAuth2.0 Seguro
**Del checklist**: "Revisar flujos OAuth (Authorization Code Flow). El token no debe exponerse en URLs ni en logs."

**Estado**: ✅ **Implementado**
**Acción**: Verificar que tokens no aparecen en logs

---

### 12. ✅ Validación de Tokens de Sesión al Cerrar Sesión
**Del checklist**: "Revisar que los JWT expiren al cerrar sesión. Verificar invalidación inmediata."

**Estado**: 
- ⚠️ JWT expira después de 1 día (no inmediatamente)
- ❌ Falta implementar logout que revoque token (ver punto 1)

---

### 13. ✅ Evaluación de Cookies
**Del checklist**: "Revisar cookies con DevTools. Deben tener atributos HttpOnly, Secure, SameSite."

**Estado**: 
- ⚠️ Actualmente tokens se envían en Authorization header (no cookies)
- ⚠️ Si se usan cookies en el futuro, deben tener estos atributos

**Acción**: Verificar que si se implementan cookies, tengan estos atributos

---

## 📊 Resumen

### Implementado ✅
- Validación de datos de entrada
- Hash seguro de contraseñas (bcrypt)
- Requisitos de complejidad de contraseña
- Recuperación de contraseña con expiración
- Validación de usuario (no revela existencia)
- Limitación de intentos de recuperación
- Bloqueo tras intentos fallidos
- Tokens JWT seguros
- OAuth2.0 seguro
- Protección XSS
- Protección SQL injection
- Headers de seguridad HTTP
- Logging seguro
- Verificación de correo (OTP)
- Uso de salts (automático en bcrypt)
- Política de longitud mínima

### Falta Implementar ❌
1. **Revocación de sesiones activas** (crítico)
2. **Protección CSRF** (crítico)
3. **Sesiones expiradas por inactividad** (crítico)
4. **MFA** (importante)
5. **Validación de respuestas comunes** (importante)
6. **RBAC/Control de acceso** (importante)

### Solo Verificar ✅
- Verificación de correo funciona
- Contraseñas hasheadas en BD
- HTTPS válido
- Estructura JWT correcta
- Tokens no en logs
- Cookies con atributos correctos (si se usan)

---

## 🚀 Prioridad de Implementación

### Prioridad Alta (Implementar Pronto)
1. Revocación de sesiones activas (logout)
2. Protección CSRF

### Prioridad Media
3. Sesiones expiradas por inactividad
4. RBAC básico

### Prioridad Baja (Opcional)
5. MFA
6. Validación de respuestas comunes


