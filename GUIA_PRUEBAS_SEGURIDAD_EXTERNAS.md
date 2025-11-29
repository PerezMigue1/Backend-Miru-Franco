# 🔐 Guía de Pruebas de Seguridad

## 🛠️ Herramientas y Qué Hacer con Cada Una

---

## 1. 📮 Postman - Pruebas Manuales de API

**Qué es**: Herramienta para enviar peticiones HTTP manualmente.

**Qué hacer**:

### Instalación
1. Descargar: https://www.postman.com/downloads/
2. Instalar y crear cuenta gratuita

### Probar Validación de Contraseñas

1. **Crear nueva petición**: `POST /api/usuarios/registrar`
2. **Body (JSON)**:
   ```json
   {
     "nombre": "Test",
     "email": "test@test.com",
     "password": "pass1",
     ...
   }
   ```
3. **Enviar** → Debe dar error: "La contraseña debe tener al menos 8 caracteres..."

### Probar SQL Injection

1. **Crear petición**: `POST /api/usuarios/login`
2. **Body**:
   ```json
   {
     "email": "test@test.com' OR '1'='1",
     "password": "cualquiercosa"
   }
   ```
3. **Enviar** → Debe dar error 401, NO debe ejecutar SQL

### Probar XSS

1. **Crear petición**: `POST /api/usuarios/registrar`
2. **Body**:
   ```json
   {
     "nombre": "<script>alert('XSS')</script>",
     ...
   }
   ```
3. **Enviar** → El script NO debe ejecutarse

---

## 2. 🕷️ OWASP ZAP - Escaneo Automático

**Qué es**: Herramienta que escanea tu API automáticamente buscando vulnerabilidades.

**Qué hacer**:

### Instalación
1. Descargar: https://www.zaproxy.org/download/
2. Instalar y abrir

### Escaneo Básico

1. **Quick Start Tab** → Ingresar URL: `https://miru-franco.onrender.com`
2. **Clic en "Attack"**
3. **Esperar 10-30 minutos**
4. **Ver resultados en tab "Alerts"**
   - 🔴 High: Corregir inmediatamente
   - 🟡 Medium: Revisar
   - 🟢 Low: Opcional

### Qué Buscar en Resultados
- ❌ Si aparece "SQL Injection" → Revisar inmediatamente
- ❌ Si aparece "XSS" → Corregir
- ✅ Headers faltantes pueden ser falsos positivos (verificar manualmente)

---

## 3. 🔧 Burp Suite - Proxy e Interceptación

**Qué es**: Proxy que captura y permite modificar peticiones HTTP.

**Qué hacer**:

### Instalación
1. Descargar Community: https://portswigger.net/burp/communitydownload
2. Instalar y abrir

### Configuración
1. **Burp → Proxy → Options** → Verificar puerto `8080`
2. **Configurar navegador**:
   - Chrome: Settings → Advanced → System → Open proxy settings
   - Proxy: `127.0.0.1:8080`
3. **Instalar certificado de Burp**:
   - Navegar a `http://burpsuite`
   - Descargar e instalar certificado CA

### Interceptar y Modificar Peticiones

1. **Proxy → Intercept** → Activar "Intercept is on"
2. **Hacer login desde navegador** → Petición queda en Burp
3. **Modificar email**: Cambiar a `test@test.com' OR '1'='1`
4. **Clic "Forward"** → Enviar petición modificada
5. **Ver respuesta** → Debe rechazar sin ejecutar SQL

---

## 4. 🌐 SecurityHeaders.com - Verificar Headers HTTP

**Qué es**: Servicio online que verifica headers de seguridad.

**Qué hacer**:

1. **Ir a**: https://securityheaders.com/
2. **Ingresar URL**: `https://miru-franco.onrender.com`
3. **Clic "Scan"**
4. **Verificar calificación**: Debe ser **A** o **B+**
5. **Verificar headers presentes**:
   - ✅ X-Content-Type-Options
   - ✅ X-Frame-Options
   - ✅ X-XSS-Protection
   - ✅ Strict-Transport-Security
   - ✅ Content-Security-Policy

---

## 5. 🔒 SSL Labs - Pruebas de HTTPS/TLS

**Qué es**: Servicio online que analiza la configuración SSL/TLS.

**Qué hacer**:

1. **Ir a**: https://www.ssllabs.com/ssltest/
2. **Ingresar**: `miru-franco.onrender.com`
3. **Clic "Submit"**
4. **Esperar 2-5 minutos**
5. **Verificar calificación**: Debe ser **A** o **A-** (mínimo)
6. **Verificar TLS**: Debe soportar TLS 1.2 o superior
   - ❌ NO debe soportar TLS 1.0 o 1.1

---

## 6. 📦 npm audit - Vulnerabilidades en Dependencias

**Qué es**: Herramienta incluida con Node.js que verifica vulnerabilidades en paquetes npm.

**Qué hacer**:

1. **Abrir terminal en carpeta del proyecto**
2. **Ejecutar**:
   ```bash
   npm audit
   ```
3. **Ver resultados**:
   - ✅ Sin vulnerabilidades críticas = OK
   - ⚠️ Solo vulnerabilidades bajas = Aceptable
   - ❌ Vulnerabilidades críticas = Corregir con `npm audit fix`

4. **Corregir si hay problemas**:
   ```bash
   npm audit fix
   ```

---

## 7. 🖥️ curl - Pruebas desde Terminal

**Qué es**: Herramienta de línea de comandos para hacer peticiones HTTP.

**Qué hacer**:

### Probar Fuerza Bruta (Bloqueo de Cuenta)

**Script** (`test-brute.sh`):
```bash
#!/bin/bash
API_URL="https://miru-franco.onrender.com"

for i in {1..6}; do
  echo "Intento $i"
  curl -X POST "$API_URL/api/usuarios/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
  echo ""
  sleep 1
done
```

**Ejecutar**:
```bash
chmod +x test-brute.sh
./test-brute.sh
```

**Resultado esperado**: Después de 5 intentos, debe bloquear la cuenta.

### Probar Rate Limiting

**Script** (`test-rate.sh`):
```bash
#!/bin/bash
API_URL="https://miru-franco.onrender.com"

for i in {1..10}; do
  curl -X POST "$API_URL/api/usuarios/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"test"}' \
    -w "\nStatus: %{http_code}\n"
  sleep 0.1
done
```

**Resultado esperado**: Después de 5 peticiones rápidas, debe dar 429 (Too Many Requests).

### Verificar Headers

```bash
curl -I https://miru-franco.onrender.com/api/auth/test
```

**Verificar que aparezcan**:
- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `x-xss-protection: 1; mode=block`

---

## 8. 🔍 jwt.io - Verificar Tokens JWT

**Qué es**: Herramienta online para decodificar y verificar tokens JWT.

**Qué hacer**:

1. **Hacer login y obtener token**:
   ```bash
   curl -X POST "$API_URL/api/usuarios/login" \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"TestPassword123"}'
   ```

2. **Copiar el token** de la respuesta

3. **Ir a**: https://jwt.io/

4. **Pegar token** en el campo "Encoded"

5. **Verificar estructura**:
   - ✅ Debe tener 3 partes separadas por puntos
   - ✅ Header debe tener `"alg":"HS256"`
   - ✅ Payload debe tener `exp` (expiración)
   - ✅ Payload debe tener `id` y `email`

---

## 9. 📋 Render Logs - Verificar Logging Seguro

**Qué es**: Logs del servidor en Render donde puedes ver qué se registra.

**Qué hacer**:

1. **Ir a dashboard de Render**: https://dashboard.render.com/
2. **Seleccionar tu servicio backend**
3. **Ir a pestaña "Logs"**
4. **Hacer un login de prueba**:
   ```bash
   curl -X POST "$API_URL/api/usuarios/login" \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"MiPassword123"}'
   ```
5. **Revisar logs inmediatamente después**

**Verificar**:
- ❌ NO debe aparecer "MiPassword123" o cualquier contraseña
- ❌ NO debe aparecer tokens JWT completos
- ✅ Puede aparecer "***REDACTED***" para datos sensibles

---

## 10. 🧪 Probar Enumeración de Usuarios

**Qué es**: Verificar que el backend no revele si un usuario existe o no.

**Qué hacer**:

### Con curl

**Email que NO existe**:
```bash
curl -X POST "$API_URL/api/usuarios/pregunta-seguridad" \
  -H "Content-Type: application/json" \
  -d '{"email":"noexiste@test.com"}'
```

**Email que SÍ existe**:
```bash
curl -X POST "$API_URL/api/usuarios/pregunta-seguridad" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

**Comparar respuestas**:
- ❌ MALO: Una dice "Usuario no encontrado", otra dice "Pregunta: ..."
- ✅ BUENO: Ambas dan mensaje similar tipo "No se encontró pregunta..."

---

## 📊 Checklist Rápido

- [ ] Postman: Contraseñas inválidas rechazadas
- [ ] Postman: SQL injection no funciona
- [ ] OWASP ZAP: Sin vulnerabilidades críticas
- [ ] SecurityHeaders.com: Calificación A o B+
- [ ] SSL Labs: Calificación A- o superior
- [ ] npm audit: Sin vulnerabilidades críticas
- [ ] curl: Cuenta se bloquea después de 5 intentos
- [ ] curl: Rate limiting funciona (429 después de límite)
- [ ] jwt.io: Tokens tienen estructura válida y expiran
- [ ] Render Logs: No hay contraseñas ni tokens en logs
- [ ] Enumeración: No revela si usuario existe

---

## 🆘 Problemas Comunes

### Burp/ZAP no captura peticiones
- Verificar que proxy esté en `127.0.0.1:8080`
- Instalar certificado CA de la herramienta
- Verificar que navegador use el proxy

### curl no funciona en Windows
- Usar Git Bash o instalar curl desde: https://curl.se/windows/

### No encuentro logs en Render
- Dashboard → Servicio → Tab "Logs"
- Usar buscador para filtrar

---

## 📚 Enlaces Rápidos

- **Postman**: https://www.postman.com/downloads/
- **OWASP ZAP**: https://www.zaproxy.org/download/
- **Burp Suite**: https://portswigger.net/burp/communitydownload
- **SecurityHeaders**: https://securityheaders.com/
- **SSL Labs**: https://www.ssllabs.com/ssltest/
- **jwt.io**: https://jwt.io/
