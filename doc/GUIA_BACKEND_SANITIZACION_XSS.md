# Guía: Implementación de Sanitización XSS en Backend

Esta guía detalla cómo implementar la sanitización de datos de entrada en el backend para prevenir ataques XSS (Cross-Site Scripting) en el proceso de registro de usuarios.

## 📋 Tabla de Contenidos

1. [Crear Utilidad de Sanitización](#1-crear-utilidad-de-sanitización)
2. [Modificar Controlador de Registro](#2-modificar-controlador-de-registro)
3. [Aplicar en Otros Endpoints](#3-aplicar-en-otros-endpoints)
4. [Pruebas](#4-pruebas)
5. [Consideraciones Adicionales](#5-consideraciones-adicionales)

---

## 1. Crear Utilidad de Sanitización

**Archivo:** `utils/sanitize.js` (CREAR NUEVO)

Crea un archivo nuevo con funciones de sanitización reutilizables:

```javascript
/**
 * Sanitiza entrada de usuario para prevenir XSS
 * Escapa caracteres HTML peligrosos que podrían ejecutarse como código
 * 
 * @param {string} input - Texto a sanitizar
 * @returns {string} - Texto sanitizado
 */
export const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }
  
  return input
    .replace(/</g, '&lt;')      // < → &lt;
    .replace(/>/g, '&gt;')      // > → &gt;
    .replace(/"/g, '&quot;')    // " → &quot;
    .replace(/'/g, '&#x27;')    // ' → &#x27;
    .replace(/\//g, '&#x2F;')   // / → &#x2F;
    .trim();                     // Eliminar espacios al inicio y final
};

/**
 * Sanitiza email (solo normaliza, no escapa HTML)
 * Los emails no necesitan escape HTML porque no se renderizan como HTML
 * 
 * @param {string} email - Email a normalizar
 * @returns {string} - Email normalizado
 */
export const sanitizeEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return '';
  }
  return email.toLowerCase().trim();
};

/**
 * Sanitiza teléfono (solo permite números y caracteres permitidos)
 * 
 * @param {string} phone - Teléfono a sanitizar
 * @returns {string} - Teléfono sanitizado
 */
export const sanitizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  // Solo permite números, espacios, guiones, paréntesis y el símbolo +
  return phone.replace(/[^\d\s\-\+\(\)]/g, '').trim();
};

/**
 * Sanitiza código postal (solo números)
 * 
 * @param {string} postalCode - Código postal a sanitizar
 * @returns {string} - Código postal sanitizado
 */
export const sanitizePostalCode = (postalCode) => {
  if (!postalCode || typeof postalCode !== 'string') {
    return '';
  }
  // Solo permite números
  return postalCode.replace(/\D/g, '');
};

/**
 * Sanitiza un objeto completo de datos de usuario
 * Aplica sanitización a todos los campos de texto del objeto de registro
 * 
 * @param {object} registerData - Datos de registro del usuario
 * @returns {object} - Datos sanitizados
 */
export const sanitizeRegisterData = (registerData) => {
  if (!registerData || typeof registerData !== 'object') {
    return {};
  }

  const sanitized = {
    ...registerData,
    // Sanitizar campos principales
    nombre: sanitizeInput(registerData.nombre || ''),
    email: sanitizeEmail(registerData.email || ''),
    telefono: sanitizePhone(registerData.telefono || ''),
    fechaNacimiento: registerData.fechaNacimiento, // Las fechas no necesitan sanitización
    
    // Sanitizar pregunta de seguridad
    preguntaSeguridad: registerData.preguntaSeguridad ? {
      pregunta: sanitizeInput(registerData.preguntaSeguridad.pregunta || ''),
      respuesta: sanitizeInput(registerData.preguntaSeguridad.respuesta || ''),
    } : undefined,
    
    // Sanitizar dirección
    direccion: registerData.direccion ? {
      calle: sanitizeInput(registerData.direccion.calle || ''),
      numero: sanitizeInput(registerData.direccion.numero || ''),
      colonia: sanitizeInput(registerData.direccion.colonia || ''),
      codigoPostal: sanitizePostalCode(registerData.direccion.codigoPostal || ''),
      referencia: registerData.direccion.referencia 
        ? sanitizeInput(registerData.direccion.referencia) 
        : undefined,
    } : undefined,
    
    // Sanitizar perfil capilar
    perfilCapilar: registerData.perfilCapilar ? {
      tipoCabello: registerData.perfilCapilar.tipoCabello || 'liso', // Enum, no necesita sanitización
      tieneAlergias: registerData.perfilCapilar.tieneAlergias || false,
      alergias: registerData.perfilCapilar.alergias 
        ? sanitizeInput(registerData.perfilCapilar.alergias) 
        : undefined,
      tratamientosQuimicos: registerData.perfilCapilar.tratamientosQuimicos || false,
      tratamientos: registerData.perfilCapilar.tratamientos 
        ? sanitizeInput(registerData.perfilCapilar.tratamientos) 
        : undefined,
    } : undefined,
    
    // Campos booleanos no necesitan sanitización
    aceptaAvisoPrivacidad: registerData.aceptaAvisoPrivacidad || false,
    recibePromociones: registerData.recibePromociones || false,
  };

  // La contraseña NO se sanitiza aquí (se hashea en el backend)
  // password: registerData.password (se procesa con bcrypt)

  return sanitized;
};
```

---

## 2. Modificar Controlador de Registro

**Archivo:** `controllers/authController.js`

### 2.1. Importar las funciones de sanitización

Agrega el import al inicio del archivo:

```javascript
// ... otros imports ...
import { sanitizeRegisterData } from '../utils/sanitize.js';
```

### 2.2. Modificar la función `registerUser`

Modifica la función para sanitizar los datos **ANTES** de procesarlos:

```javascript
// 🔹 Registro tradicional
export const registerUser = async (req, res) => {
  try {
    // ⚠️ IMPORTANTE: Sanitizar TODOS los datos recibidos antes de procesarlos
    // Esto previene XSS incluso si alguien envía peticiones directas (bypass del frontend)
    const sanitizedData = sanitizeRegisterData(req.body);
    
    const {
      nombre,
      email,
      password,
      telefono,
      fechaNacimiento,
      preguntaSeguridad,
      direccion,
      perfilCapilar,
      aceptaAvisoPrivacidad,
      recibePromociones,
    } = sanitizedData;

    // Validación de campos requeridos
    if (!nombre || !email || !password || !telefono) {
      return res.status(400).json({ 
        success: false,
        error: "Faltan campos obligatorios" 
      });
    }

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

    // Crear usuario con datos sanitizados
    // ⚠️ IMPORTANTE: Usar sanitizedData, NO req.body directamente
    const user = new Usuario({
      nombre,              // ✅ Ya sanitizado
      email,               // ✅ Ya sanitizado
      password: hashedPassword,
      telefono,            // ✅ Ya sanitizado
      fechaNacimiento,
      preguntaSeguridad,   // ✅ Ya sanitizado (objeto completo)
      direccion,           // ✅ Ya sanitizado (objeto completo)
      perfilCapilar,       // ✅ Ya sanitizado (objeto completo)
      aceptaAvisoPrivacidad,
      recibePromociones,
      codigoOTP,
      otpExpira,
      confirmado: false,
    });

    await user.save();
    console.log("Usuario registrado:", email, "OTP:", codigoOTP, "Expira en 2 minutos");

    // Enviar correo con el código OTP
    try {
      await sendOTPEmail(email, codigoOTP);
      
      return res.status(201).json({ 
        success: true,
        message: "Ingresa el código para activar tu cuenta. El código expira en 2 minutos.",
        requiereVerificacion: true
      });
    } catch (err) {
      console.error("Error al enviar correo de activación:", err);
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

## 3. Aplicar en Otros Endpoints

### 3.1. Endpoint de Verificación de Correo

**Archivo:** `controllers/authController.js`

```javascript
import { sanitizeEmail } from '../utils/sanitize.js';

export const verificarCorreoExistente = async (req, res) => {
  // Sanitizar email antes de buscar
  const correo = sanitizeEmail(req.body.correo || req.body.email);

  if (!correo) {
    return res.status(400).json({ 
      existe: false,
      message: "Correo no proporcionado" 
    });
  }

  try {
    const usuario = await Usuario.findOne({ email: correo });
    
    return res.status(200).json({ 
      existe: !!usuario,
      message: usuario ? "Este correo ya está registrado" : "Correo disponible"
    });
  } catch (error) {
    console.error("Error al verificar correo:", error);
    return res.status(500).json({ 
      existe: false,
      message: "Error al verificar el correo" 
    });
  }
};
```

### 3.2. Endpoint de Actualización de Perfil

Si tienes un endpoint para actualizar el perfil del usuario:

```javascript
import { sanitizeInput, sanitizePhone } from '../utils/sanitize.js';

export const actualizarPerfil = async (req, res) => {
  try {
    const userId = req.user.id; // Asumiendo que tienes middleware de autenticación
    
    const datosActualizados = {
      nombre: sanitizeInput(req.body.nombre),
      telefono: sanitizePhone(req.body.telefono),
      direccion: req.body.direccion ? {
        calle: sanitizeInput(req.body.direccion.calle),
        colonia: sanitizeInput(req.body.direccion.colonia),
        // ... otros campos
      } : undefined,
    };

    const usuario = await Usuario.findByIdAndUpdate(
      userId,
      { $set: datosActualizados },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Perfil actualizado correctamente",
      data: usuario
    });
  } catch (error) {
    console.error("Error al actualizar perfil:", error);
    return res.status(500).json({
      success: false,
      error: "Error al actualizar el perfil"
    });
  }
};
```

---

## 4. Pruebas

### 4.1. Prueba con Postman o cURL

**Prueba 1: XSS en nombre**
```bash
curl -X POST http://localhost:3000/api/usuarios/registrar \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "<script>alert(\"XSS\")</script>Juan Pérez",
    "email": "test@example.com",
    "password": "Password123!",
    "telefono": "1234567890",
    "fechaNacimiento": "1990-01-01",
    "preguntaSeguridad": {
      "pregunta": "¿Cuál es tu color favorito?",
      "respuesta": "Azul"
    },
    "direccion": {
      "calle": "Calle Principal",
      "numero": "123",
      "colonia": "Centro",
      "codigoPostal": "12345"
    },
    "perfilCapilar": {
      "tipoCabello": "liso",
      "tieneAlergias": false,
      "tratamientosQuimicos": false
    },
    "aceptaAvisoPrivacidad": true,
    "recibePromociones": false
  }'
```

**Resultado esperado:**
- El nombre en la base de datos debe guardarse como: `&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;Juan Pérez`
- NO debe ejecutarse ningún script

**Prueba 2: XSS en múltiples campos**
```bash
curl -X POST http://localhost:3000/api/usuarios/registrar \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Juan <img src=x onerror=alert(1)>",
    "email": "test2@example.com",
    "password": "Password123!",
    "telefono": "1234567890",
    "preguntaSeguridad": {
      "pregunta": "Pregunta",
      "respuesta": "<script>document.cookie</script>"
    },
    "direccion": {
      "calle": "Calle <script>alert(1)</script>",
      "colonia": "Colonia"
    },
    "perfilCapilar": {
      "tipoCabello": "liso",
      "tieneAlergias": true,
      "alergias": "<svg onload=alert(1)>"
    },
    "aceptaAvisoPrivacidad": true,
    "recibePromociones": false
  }'
```

**Verificar en la base de datos:**
Todos los campos deben estar sanitizados (con `&lt;`, `&gt;`, `&quot;`, etc.)

### 4.2. Prueba desde el Frontend

1. Abre la consola del navegador (F12)
2. Intenta registrar un usuario con: `<script>alert('XSS')</script>` en el nombre
3. Verifica en la base de datos que se guardó sanitizado
4. Cuando se muestre el perfil, NO debe ejecutarse el script

---

## 5. Consideraciones Adicionales

### 5.1. Middleware Global (Opcional pero Recomendado)

Puedes crear un middleware que sanitice automáticamente todos los campos de texto en `req.body`:

**Archivo:** `middleware/sanitizeMiddleware.js`

```javascript
import { sanitizeRegisterData, sanitizeInput, sanitizeEmail } from '../utils/sanitize.js';

/**
 * Middleware para sanitizar automáticamente los datos de entrada
 * Aplica sanitización según el tipo de endpoint
 */
export const sanitizeBody = (req, res, next) => {
  // Solo sanitizar si hay un body
  if (!req.body || typeof req.body !== 'object') {
    return next();
  }

  // Sanitizar según la ruta
  if (req.path.includes('/registrar')) {
    req.body = sanitizeRegisterData(req.body);
  } else if (req.path.includes('/verificar-correo')) {
    req.body.correo = sanitizeEmail(req.body.correo || req.body.email);
  } else {
    // Sanitización genérica para otros endpoints
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        // No sanitizar contraseñas, tokens, etc.
        if (!['password', 'token', 'codigo', 'otp'].includes(key.toLowerCase())) {
          req.body[key] = sanitizeInput(req.body[key]);
        }
      }
    });
  }

  next();
};
```

**Uso en las rutas:**
```javascript
import express from 'express';
import { sanitizeBody } from '../middleware/sanitizeMiddleware.js';

const router = express.Router();

// Aplicar middleware de sanitización a todas las rutas
router.use(sanitizeBody);

router.post('/registrar', registerUser);
router.post('/verificar-correo', verificarCorreoExistente);
// ... otras rutas
```

### 5.2. Validación de Datos

Además de sanitizar, siempre valida:

```javascript
import { body, validationResult } from 'express-validator';

export const validateRegister = [
  body('nombre')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Email inválido'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas, números y caracteres especiales'),
  // ... más validaciones
];

// Uso:
router.post('/registrar', validateRegister, registerUser);
```

### 5.3. Librerías Alternativas

Si prefieres usar una librería ya probada, considera:

**DOMPurify (para Node.js):**
```bash
npm install dompurify jsdom
```

```javascript
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

export const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') return '';
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] }); // Sin tags HTML
};
```

**xss (específica para XSS):**
```bash
npm install xss
```

```javascript
import xss from 'xss';

export const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') return '';
  return xss(input, { whiteList: {}, stripIgnoreTag: true });
};
```

---

## ✅ Checklist de Implementación

- [ ] Crear archivo `utils/sanitize.js` con funciones de sanitización
- [ ] Modificar función `registerUser` para sanitizar datos antes de guardar
- [ ] Modificar función `verificarCorreoExistente` para sanitizar email
- [ ] Aplicar sanitización en otros endpoints que reciben datos del usuario
- [ ] Probar con Postman enviando `<script>alert(1)</script>` en diferentes campos
- [ ] Verificar en la base de datos que los datos se guardan sanitizados
- [ ] Probar desde el frontend que no se ejecutan scripts
- [ ] (Opcional) Crear middleware global de sanitización
- [ ] (Opcional) Agregar validación con express-validator
- [ ] Documentar los cambios en el código

---

## 🔒 Importante

1. **Nunca confíes solo en el frontend**: Siempre sanitiza en el backend
2. **Sanitiza antes de guardar**: No solo antes de mostrar
3. **Contraseñas**: NO sanitices las contraseñas (se hashean con bcrypt)
4. **Emails**: Solo normaliza (minúsculas, trim), no escapes HTML
5. **Números**: Valida que sean números, no solo sanitiza strings
6. **Fechas**: Valida formato, no sanitices como HTML

---

## 📚 Referencias

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)

