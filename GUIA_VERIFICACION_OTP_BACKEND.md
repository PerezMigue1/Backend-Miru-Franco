# Guía de Implementación: Verificación de Correo con OTP (Backend)

Esta guía detalla los cambios necesarios en el backend para implementar la verificación de correo electrónico mediante código OTP (One-Time Password) de 6 dígitos.

## 📋 Tabla de Contenidos

1. [Modificaciones al Modelo de Usuario](#1-modificaciones-al-modelo-de-usuario)
2. [Configuración del Servicio de Email](#2-configuración-del-servicio-de-email)
3. [Modificaciones al Controlador de Registro](#3-modificaciones-al-controlador-de-registro)
4. [Nuevos Endpoints](#4-nuevos-endpoints)
5. [Modificaciones al Login](#5-modificaciones-al-login)
6. [Rutas](#6-rutas)
7. [Variables de Entorno](#7-variables-de-entorno)
8. [Flujo Completo](#8-flujo-completo)

---

## 1. Modificaciones al Modelo de Usuario

Agregar los siguientes campos al esquema del modelo `Usuario`:

```javascript
// Ejemplo con Mongoose (Node.js/Express)
const usuarioSchema = new mongoose.Schema({
  // ... campos existentes ...
  
  // Campos para verificación OTP
  codigoOTP: {
    type: String,
    default: null
  },
  otpExpira: {
    type: Date,
    default: null
  },
  confirmado: {
    type: Boolean,
    default: false
  },
  
  // ... resto de campos ...
});
```

**Nota:** Si usas otro ORM o base de datos, adapta la sintaxis según corresponda.

---

## 2. Configuración del Servicio de Email

Necesitas un servicio para enviar correos. Aquí hay ejemplos para **SendGrid** y **Mailgun**:

### Opción A: SendGrid

**Instalación:**
```bash
npm install @sendgrid/mail
```

**Archivo: `utils/sendEmail.js`**
```javascript
import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const sendOTPEmail = async (correo, codigoOTP) => {
  try {
    const msg = {
      to: correo,
      from: {
        name: process.env.SENDGRID_FROM_NAME || "Miru Franco Salón Beauty",
        email: process.env.SENDGRID_FROM_EMAIL,
      },
      subject: "Código de activación - Miru Franco",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #710014;">Bienvenido a Miru Franco Salón Beauty</h2>
          <p>Tu código de verificación es:</p>
          <div style="background-color: #f2f1ed; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h1 style="color: #161616; font-size: 32px; letter-spacing: 8px; margin: 0;">${codigoOTP}</h1>
          </div>
          <p style="color: #666;">Ingresa este código en la aplicación para activar tu cuenta.</p>
          <p style="color: #666; font-size: 12px;">Este código expira en 2 minutos.</p>
          <p style="color: #666; font-size: 12px;">Si no solicitaste este código, ignora este mensaje.</p>
        </div>
      `,
    };
    
    await sgMail.send(msg);
    console.log("Correo de activación enviado a:", correo);
  } catch (err) {
    console.error("Error enviando correo de activación:", err.response?.body || err.message);
    throw new Error("No se pudo enviar el correo de activación");
  }
};
```

### Opción B: Mailgun

**Instalación:**
```bash
npm install mailgun.js
```

**Archivo: `utils/sendEmail.js`**
```javascript
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
});

export const sendOTPEmail = async (correo, codigoOTP) => {
  try {
    const domain = process.env.MAILGUN_DOMAIN;
    
    const messageData = {
      from: `${process.env.MAILGUN_FROM_NAME || 'Miru Franco'} <${process.env.MAILGUN_FROM_EMAIL}>`,
      to: correo,
      subject: 'Código de activación - Miru Franco',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #710014;">Bienvenido a Miru Franco Salón Beauty</h2>
          <p>Tu código de verificación es:</p>
          <div style="background-color: #f2f1ed; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h1 style="color: #161616; font-size: 32px; letter-spacing: 8px; margin: 0;">${codigoOTP}</h1>
          </div>
          <p style="color: #666;">Ingresa este código en la aplicación para activar tu cuenta.</p>
          <p style="color: #666; font-size: 12px;">Este código expira en 2 minutos.</p>
          <p style="color: #666; font-size: 12px;">Si no solicitaste este código, ignora este mensaje.</p>
        </div>
      `,
    };

    await mg.messages.create(domain, messageData);
    console.log("Correo de activación enviado a:", correo);
  } catch (err) {
    console.error("Error enviando correo de activación:", err);
    throw new Error("No se pudo enviar el correo de activación");
  }
};
```

---

## 3. Modificaciones al Controlador de Registro

Modificar la función de registro para generar y enviar el código OTP:

**Archivo: `controllers/authController.js` (o similar)**

```javascript
import { sendOTPEmail } from "../utils/sendEmail.js";
// ... otros imports ...

export const registerUser = async (req, res) => {
  const {
    nombre,
    email,
    password,
    telefono,
    // ... otros campos ...
  } = req.body;

  try {
    // Verificar si el usuario ya existe
    const existingUser = await Usuario.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: "Correo ya registrado" 
      });
    }

    // Hash de la contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generar código OTP de 6 dígitos
    const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Calcular fecha de expiración (2 minutos desde ahora)
    const otpExpira = new Date(Date.now() + 2 * 60 * 1000);

    // Crear usuario con confirmado: false
    const user = new Usuario({
      nombre,
      email,
      password: hashedPassword,
      telefono,
      // ... otros campos ...
      codigoOTP,
      otpExpira,
      confirmado: false, // IMPORTANTE: La cuenta no está confirmada aún
    });

    await user.save();
    console.log("Usuario registrado:", email, "OTP:", codigoOTP, "Expira en 2 minutos");

    // Enviar correo con el código OTP
    try {
      await sendOTPEmail(email, codigoOTP);
      
      return res.status(201).json({ 
        success: true,
        message: "Ingresa el código para activar tu cuenta. El código expira en 2 minutos.",
        requiereVerificacion: true // Indicar al frontend que requiere verificación
      });
    } catch (err) {
      console.error("Error al enviar correo de activación:", err);
      // Aún así, el usuario fue creado, pero no se pudo enviar el correo
      return res.status(500).json({
        success: false,
        error: "Usuario registrado, pero no se pudo enviar el correo de activación. Contacta al soporte."
      });
    }
  } catch (err) {
    console.error("Error al registrar usuario:", err);
    return res.status(500).json({ 
      success: false,
      error: "Error al registrar usuario" 
    });
  }
};
```

---

## 4. Nuevos Endpoints

### 4.1. Verificar OTP

**Endpoint:** `POST /api/usuarios/verificar-otp`

**Body:**
```json
{
  "email": "usuario@ejemplo.com",
  "codigo": "123456"
}
```

**Implementación:**
```javascript
export const verificarOTP = async (req, res) => {
  const { email, codigo } = req.body;

  try {
    const usuario = await Usuario.findOne({ email });
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        error: "Usuario no encontrado." 
      });
    }

    // Verificar si hay código activo
    if (!usuario.codigoOTP) {
      return res.status(400).json({ 
        success: false,
        error: "No hay código activo. Solicita uno nuevo." 
      });
    }

    // Verificar si el código ha expirado (2 minutos)
    if (usuario.otpExpira < new Date()) {
      return res.status(400).json({ 
        success: false,
        error: "Código expirado. El código OTP solo es válido por 2 minutos. Solicita uno nuevo." 
      });
    }

    // Verificar que el código coincida
    if (usuario.codigoOTP !== codigo) {
      return res.status(400).json({ 
        success: false,
        error: "Código incorrecto." 
      });
    }

    // Código correcto: activar cuenta y limpiar código
    usuario.codigoOTP = undefined;
    usuario.otpExpira = undefined;
    usuario.confirmado = true;
    await usuario.save();

    res.status(200).json({ 
      success: true,
      message: "Código verificado correctamente. Cuenta activada." 
    });
  } catch (error) {
    console.error("Error al verificar el código:", error);
    res.status(500).json({ 
      success: false,
      error: "Error al verificar el código" 
    });
  }
};
```

### 4.2. Reenviar Código OTP

**Endpoint:** `POST /api/usuarios/reenviar-codigo`

**Body:**
```json
{
  "email": "usuario@ejemplo.com"
}
```

**Implementación:**
```javascript
export const reenviarCodigo = async (req, res) => {
  const { email } = req.body;

  try {
    const usuario = await Usuario.findOne({ email });
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        error: "Usuario no encontrado." 
      });
    }

    // Generar nuevo código OTP
    const nuevoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
    usuario.codigoOTP = nuevoCodigo;
    usuario.otpExpira = new Date(Date.now() + 2 * 60 * 1000); // 2 minutos
    await usuario.save();

    // Enviar nuevo código por correo
    await sendOTPEmail(email, nuevoCodigo);

    res.status(200).json({ 
      success: true,
      message: "Nuevo código enviado al correo. Recuerda que el código expira en 2 minutos." 
    });
  } catch (error) {
    console.error("Error al reenviar código:", error);
    res.status(500).json({ 
      success: false,
      error: "Error al reenviar el código" 
    });
  }
};
```

---

## 5. Modificaciones al Login

Modificar la función de login para verificar que la cuenta esté confirmada:

```javascript
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await Usuario.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: "El correo no está registrado" 
      });
    }

    // VERIFICAR QUE LA CUENTA ESTÉ CONFIRMADA
    if (!user.confirmado) {
      return res.status(403).json({ 
        success: false,
        error: "Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.",
        requiereVerificacion: true // Indicar al frontend que requiere verificación
      });
    }

    // Verificar contraseña
    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      return res.status(401).json({ 
        success: false,
        error: "Contraseña incorrecta" 
      });
    }

    // Login exitoso
    // Generar token JWT (o tu método de autenticación)
    const token = generarToken(user); // Tu función para generar token

    res.status(200).json({
      success: true,
      message: `Bienvenido ${user.nombre}!`,
      token: token,
      user: {
        _id: user._id,
        email: user.email,
        name: user.nombre,
      },
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ 
      success: false,
      error: "Error en el servidor" 
    });
  }
};
```

---

## 6. Rutas

Agregar las nuevas rutas en tu archivo de rutas:

**Archivo: `routes/auth.js` (o similar)**

```javascript
import express from "express";
import {
  registerUser,
  login,
  verificarOTP,
  reenviarCodigo,
  // ... otras funciones ...
} from "../controllers/authController.js";

const router = express.Router();

// Rutas existentes
router.post("/registrar", registerUser);
router.post("/login", login);

// Nuevas rutas para verificación OTP
router.post("/verificar-otp", verificarOTP);
router.post("/reenviar-codigo", reenviarCodigo);

export default router;
```

**Nota:** Asegúrate de que las rutas coincidan con lo que espera el frontend:
- `POST /api/usuarios/verificar-otp`
- `POST /api/usuarios/reenviar-codigo`

---

## 7. Variables de Entorno

Agregar las siguientes variables de entorno según el servicio de email que uses:

### Para SendGrid:
```env
SENDGRID_API_KEY=tu_api_key_de_sendgrid
SENDGRID_FROM_EMAIL=noreply@tudominio.com
SENDGRID_FROM_NAME=Miru Franco Salón Beauty
```

### Para Mailgun:
```env
MAILGUN_API_KEY=tu_api_key_de_mailgun
MAILGUN_DOMAIN=tu_dominio.mailgun.org
MAILGUN_FROM_EMAIL=noreply@tudominio.com
MAILGUN_FROM_NAME=Miru Franco Salón Beauty
```

---

## 8. Flujo Completo

### 8.1. Registro de Usuario

1. Usuario completa el formulario de registro
2. Backend crea el usuario con `confirmado: false`
3. Backend genera código OTP de 6 dígitos
4. Backend guarda `codigoOTP` y `otpExpira` (2 minutos)
5. Backend envía correo con el código
6. Backend responde con `requiereVerificacion: true`
7. Frontend muestra pantalla de activación

### 8.2. Verificación de Código

1. Usuario ingresa el código OTP recibido por correo
2. Frontend envía `POST /api/usuarios/verificar-otp` con `email` y `codigo`
3. Backend verifica:
   - Usuario existe
   - Código existe y no ha expirado
   - Código coincide
4. Si es correcto:
   - Backend marca `confirmado: true`
   - Backend limpia `codigoOTP` y `otpExpira`
   - Backend responde con éxito
5. Frontend redirige al login o inicia sesión automáticamente

### 8.3. Reenvío de Código

1. Usuario hace clic en "Reenviar código"
2. Frontend envía `POST /api/usuarios/reenviar-codigo` con `email`
3. Backend genera nuevo código OTP
4. Backend actualiza `codigoOTP` y `otpExpira`
5. Backend envía nuevo correo
6. Backend responde con éxito

### 8.4. Login

1. Usuario intenta iniciar sesión
2. Backend verifica:
   - Usuario existe
   - **Cuenta está confirmada (`confirmado: true`)**
   - Contraseña es correcta
3. Si la cuenta no está confirmada:
   - Backend responde con error: "Tu cuenta no está activada"
   - Frontend muestra opción para reenviar código o activar cuenta

---

## ✅ Checklist de Implementación

- [ ] Agregar campos `codigoOTP`, `otpExpira`, `confirmado` al modelo Usuario
- [ ] Configurar servicio de email (SendGrid o Mailgun)
- [ ] Crear función `sendOTPEmail` en `utils/sendEmail.js`
- [ ] Modificar función de registro para generar y enviar OTP
- [ ] Crear endpoint `POST /api/usuarios/verificar-otp`
- [ ] Crear endpoint `POST /api/usuarios/reenviar-codigo`
- [ ] Modificar función de login para verificar `confirmado: true`
- [ ] Agregar rutas en `routes/auth.js`
- [ ] Configurar variables de entorno
- [ ] Probar flujo completo de registro → activación → login

---

## 🔍 Notas Importantes

1. **Expiración del código:** El código expira en 2 minutos. Puedes ajustar este tiempo según tus necesidades.

2. **Seguridad:** 
   - No expongas el código OTP en logs de producción
   - Considera limitar intentos de verificación (ej: máximo 3 intentos)
   - Limpia códigos expirados periódicamente

3. **Usuarios de Google:** Si tienes autenticación con Google, los usuarios registrados con Google pueden tener `confirmado: true` automáticamente.

4. **Manejo de errores:** Asegúrate de manejar todos los casos de error y proporcionar mensajes claros al usuario.

---

## 📞 Soporte

Si tienes dudas o problemas durante la implementación, revisa:
- Los logs del servidor para errores
- La configuración del servicio de email
- Que las rutas coincidan con lo esperado por el frontend
- Que las variables de entorno estén correctamente configuradas

