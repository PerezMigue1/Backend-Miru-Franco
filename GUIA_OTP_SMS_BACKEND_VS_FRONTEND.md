# 📱 Guía: OTP por SMS - Backend vs Frontend

## 🔍 Estado Actual

**Tu backend actualmente tiene:**
- ✅ **OTP por EMAIL** implementado
- ❌ **OTP por SMS** NO implementado

## 📍 ¿Dónde se implementa OTP por SMS?

### ✅ **BACKEND** (NestJS)

El backend es responsable de:

1. **Generar el código OTP** (6 dígitos aleatorios)
2. **Almacenar el código** en la base de datos con expiración
3. **Enviar el código por SMS** usando un servicio de SMS (Twilio, AWS SNS, etc.)
4. **Validar el código** cuando el usuario lo ingresa
5. **Manejar la expiración** (actualmente 2 minutos)

### 🎨 **FRONTEND** (React/Next.js)

El frontend es responsable de:

1. **Mostrar la interfaz** para ingresar el código OTP
2. **Enviar el código al backend** para validación
3. **Mostrar mensajes de error/éxito**
4. **Manejar el flujo de verificación** (redirección después de verificación exitosa)

## 📊 Comparación: OTP por Email vs SMS

| Aspecto | Email (Actual) | SMS (Por implementar) |
|---------|----------------|----------------------|
| **Generación** | ✅ Backend | ✅ Backend |
| **Almacenamiento** | ✅ Backend (BD) | ✅ Backend (BD) |
| **Envío** | ✅ Backend (SendGrid) | ✅ Backend (Twilio/AWS SNS) |
| **Validación** | ✅ Backend | ✅ Backend |
| **Interfaz** | ✅ Frontend | ✅ Frontend |
| **Envío de código** | ✅ Frontend | ✅ Frontend |

## 🔧 Implementación en el Backend

### 1. Instalar servicio de SMS (Ejemplo con Twilio)

```bash
npm install twilio
```

### 2. Crear servicio de SMS

**Archivo:** `src/sms/sms.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as twilio from 'twilio';

@Injectable()
export class SmsService {
  private twilioClient: twilio.Twilio;

  constructor(private configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

    if (accountSid && authToken) {
      this.twilioClient = twilio(accountSid, authToken);
    } else {
      console.warn('⚠️ TWILIO no configurado. Los SMS no se enviarán.');
    }
  }

  async sendOTPSMS(telefono: string, codigoOTP: string): Promise<void> {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.configService.get<string>('TWILIO_FROM_NUMBER');

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('Twilio no está configurado. Por favor configura TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM_NUMBER.');
    }

    try {
      const message = await this.twilioClient.messages.create({
        body: `Tu código de verificación Miru Franco es: ${codigoOTP}. Expira en 2 minutos.`,
        from: fromNumber,
        to: telefono,
      });

      console.log('SMS de activación enviado a:', telefono, 'SID:', message.sid);
    } catch (err: any) {
      console.error('Error enviando SMS de activación:', err.message);
      throw new Error('No se pudo enviar el SMS de activación');
    }
  }
}
```

### 3. Crear módulo de SMS

**Archivo:** `src/sms/sms.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
```

### 4. Actualizar `usuarios.service.ts` para usar SMS

```typescript
// Agregar import
import { SmsService } from '../sms/sms.service';

// En el constructor
constructor(
  // ... otros servicios
  private smsService: SmsService,
) {}

// Modificar crearUsuario para enviar SMS en lugar de email
async crearUsuario(createUsuarioDto: CreateUsuarioDto) {
  // ... código existente ...
  
  // Generar código OTP
  const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpira = new Date(Date.now() + 2 * 60 * 1000); // 2 minutos

  // ... guardar en BD ...

  // ✅ Enviar SMS en lugar de email
  try {
    await this.smsService.sendOTPSMS(telefono, codigoOTP);
    return {
      success: true,
      message: 'Ingresa el código enviado a tu teléfono. El código expira en 2 minutos.',
      requiereVerificacion: true,
    };
  } catch (err) {
    console.error('Error al enviar SMS de activación:', err);
    throw new Error('Usuario registrado, pero no se pudo enviar el SMS de activación. Contacta al soporte.');
  }
}
```

### 5. Agregar variables de entorno

**Archivo:** `.env`

```env
# Twilio SMS
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=tu_auth_token_aqui
TWILIO_FROM_NUMBER=+1234567890  # Número de Twilio
```

### 6. Registrar módulo en `app.module.ts`

```typescript
import { SmsModule } from './sms/sms.module';

@Module({
  imports: [
    // ... otros módulos
    SmsModule,
  ],
})
export class AppModule {}
```

## 🎨 Implementación en el Frontend

El frontend **NO cambia mucho**, solo necesita:

### 1. Mostrar mensaje diferente

```jsx
// En lugar de "Revisa tu correo"
// Mostrar "Revisa tu teléfono"
<p>Se ha enviado un código de verificación a tu teléfono: {telefono}</p>
```

### 2. El endpoint de verificación es el mismo

```jsx
// El endpoint NO cambia
POST /api/usuarios/verificar-otp
{
  "email": "usuario@example.com",
  "codigo": "123456"
}
```

## 🔄 Opción: Permitir elegir Email o SMS

Si quieres permitir que el usuario elija entre Email o SMS:

### Backend: Agregar campo al DTO

```typescript
// create-usuario.dto.ts
export class CreateUsuarioDto {
  // ... campos existentes ...
  
  @IsOptional()
  @IsEnum(['email', 'sms'])
  metodoVerificacion?: 'email' | 'sms' = 'email';
}
```

### Backend: Lógica condicional

```typescript
// usuarios.service.ts
if (createUsuarioDto.metodoVerificacion === 'sms') {
  await this.smsService.sendOTPSMS(telefono, codigoOTP);
} else {
  await this.emailService.sendOTPEmail(email, codigoOTP);
}
```

### Frontend: Selector de método

```jsx
<select value={metodoVerificacion} onChange={(e) => setMetodoVerificacion(e.target.value)}>
  <option value="email">Email</option>
  <option value="sms">SMS</option>
</select>
```

## 📋 Checklist de Implementación

### Backend:
- [ ] Instalar servicio de SMS (Twilio, AWS SNS, etc.)
- [ ] Crear `SmsService` con método `sendOTPSMS()`
- [ ] Crear `SmsModule`
- [ ] Agregar variables de entorno (TWILIO_ACCOUNT_SID, etc.)
- [ ] Modificar `usuarios.service.ts` para usar SMS
- [ ] Registrar `SmsModule` en `app.module.ts`
- [ ] Probar envío de SMS

### Frontend:
- [ ] Actualizar mensajes para mencionar "teléfono" en lugar de "correo"
- [ ] (Opcional) Agregar selector de método (Email/SMS)
- [ ] Mantener el mismo endpoint de verificación

## 💰 Consideraciones de Costo

### Twilio (Ejemplo):
- **Costo por SMS**: ~$0.0075 USD por mensaje
- **Plan gratuito**: $15.50 USD de crédito al registrarse
- **Límite**: Sin límite en planes de pago

### Alternativas:
- **AWS SNS**: ~$0.00645 USD por SMS
- **Vonage (Nexmo)**: ~$0.0055 USD por SMS
- **MessageBird**: Precios variables por país

## 🔐 Seguridad

1. **No almacenar números de teléfono en texto plano** (ya lo haces con hash)
2. **Validar formato de teléfono** antes de enviar
3. **Rate limiting** (ya implementado ✅)
4. **Expiración de código** (ya implementado: 2 minutos ✅)
5. **No revelar si el número existe** (similar a email)

## 📚 Recursos

- **Twilio Docs**: https://www.twilio.com/docs/sms
- **AWS SNS Docs**: https://docs.aws.amazon.com/sns/
- **NestJS SMS Tutorial**: https://docs.nestjs.com/techniques/http-module

## ✅ Resumen

| Componente | Responsabilidad |
|------------|----------------|
| **Backend** | Generar código, enviar SMS, validar código |
| **Frontend** | Mostrar interfaz, enviar código al backend, mostrar resultados |

**La implementación de SMS debe hacerse en el BACKEND**, el frontend solo necesita ajustar los mensajes mostrados al usuario.

