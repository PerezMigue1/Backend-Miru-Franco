# 📱 Guía: Configurar Verificación por SMS (OTP)

## ✅ Implementación Completada

La verificación por SMS ha sido agregada al backend. Ahora puedes elegir entre **Email** o **SMS** para enviar códigos OTP.

## 🔧 Configuración de Twilio (Opcional)

### 1. Instalar Twilio

```bash
npm install twilio
```

### 2. Obtener credenciales de Twilio

1. Crea una cuenta en [Twilio](https://www.twilio.com/)
2. Obtén tu **Account SID** y **Auth Token** del dashboard
3. Compra un número de teléfono (o usa el número de prueba)

### 3. Agregar variables de entorno

**Archivo:** `.env`

```env
# Twilio SMS (Opcional - solo si quieres usar SMS)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=tu_auth_token_aqui
TWILIO_FROM_NUMBER=+1234567890  # Número de Twilio con código de país
```

### 4. Formato del número de teléfono

El número debe incluir el código de país:
- ✅ `+521234567890` (México)
- ✅ `+1234567890` (USA/Canadá)
- ❌ `1234567890` (sin código de país)

El sistema automáticamente formatea números mexicanos de 10 dígitos agregando `+52`.

## 📝 Uso en el Frontend

### Registro con SMS

```json
POST /api/usuarios/registro
{
  "nombre": "Usuario Test",
  "email": "usuario@test.com",
  "telefono": "+521234567890",
  "password": "Password123!",
  "fechaNacimiento": "2000-01-01",
  "metodoVerificacion": "sms",  // ← Agregar esto para usar SMS
  "preguntaSeguridad": {
    "pregunta": "¿En qué calle creciste?",
    "respuesta": "Mi calle"
  },
  "direccion": { ... },
  "perfilCapilar": { ... },
  "aceptaAvisoPrivacidad": true
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Ingresa el código enviado a tu teléfono para activar tu cuenta. El código expira en 2 minutos.",
  "requiereVerificacion": true,
  "metodo": "sms"
}
```

### Reenviar código por SMS

```json
POST /api/usuarios/reenviar-codigo
{
  "email": "usuario@test.com",
  "metodoVerificacion": "sms"  // ← Agregar esto para usar SMS
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Nuevo código enviado a tu teléfono. Recuerda que el código expira en 2 minutos.",
  "metodo": "sms"
}
```

## 🔄 Comportamiento por Defecto

Si **NO** se especifica `metodoVerificacion` o se omite:
- **Por defecto**: Se usa **Email** (comportamiento actual)
- **No se rompe nada**: El sistema sigue funcionando como antes

## ⚠️ Modo Desarrollo

Si Twilio **NO está configurado**:
- En **desarrollo**: El sistema simula el envío de SMS (muestra en consola)
- En **producción**: Lanza un error si se intenta usar SMS sin configuración

**Ejemplo en desarrollo:**
```
📱 [SIMULADO] SMS enviado a +521234567890: Tu código de verificación Miru Franco es: 123456. Expira en 2 minutos.
```

## 🧪 Probar sin Twilio

Puedes probar el flujo completo sin configurar Twilio:

1. El sistema detectará que Twilio no está configurado
2. En desarrollo, simulará el envío
3. Puedes usar el código que aparece en la consola para verificar

## 📊 Comparación: Email vs SMS

| Aspecto | Email | SMS |
|---------|-------|-----|
| **Configuración requerida** | SendGrid | Twilio (opcional) |
| **Costo** | Gratis (hasta cierto límite) | ~$0.0075 USD por SMS |
| **Velocidad** | Variable (segundos a minutos) | Inmediato (segundos) |
| **Disponibilidad** | Requiere internet en email | Requiere señal móvil |
| **Por defecto** | ✅ Sí | ❌ No (opcional) |

## 🔐 Seguridad

- ✅ El código OTP sigue siendo de 6 dígitos
- ✅ Expira en 2 minutos (igual que email)
- ✅ Rate limiting aplicado (3 intentos/minuto)
- ✅ No se revela si el número existe
- ✅ Validación de formato de teléfono

## 📚 Recursos

- **Twilio Docs**: https://www.twilio.com/docs/sms
- **Twilio Console**: https://console.twilio.com/
- **Twilio Pricing**: https://www.twilio.com/pricing

## ✅ Resumen

1. ✅ **SMS implementado** - Funciona junto con Email
2. ✅ **Opcional** - No rompe nada si no está configurado
3. ✅ **Por defecto Email** - Mantiene compatibilidad
4. ✅ **Fácil de configurar** - Solo agregar variables de entorno
5. ✅ **Modo desarrollo** - Simula SMS si no está configurado

¡La implementación está lista! Solo necesitas configurar Twilio si quieres usar SMS en producción.

