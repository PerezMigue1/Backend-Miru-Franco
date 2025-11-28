# 🔧 Solución: Recuperación de Contraseña - Preguntas de Seguridad

## ⚠️ Problema Reportado

1. **Usuario de Google**: Le aparece una pregunta (NO debería aparecer nada)
2. **Usuario registrado**: NO le aparece la pregunta que escogió al crear la cuenta

## ✅ Solución: Endpoints Correctos

### Para RECUPERACIÓN DE CONTRASEÑA (mostrar pregunta del usuario)

**Endpoint:** `POST /api/usuarios/pregunta-seguridad`

**Request:**
```json
{
  "email": "usuario@example.com"
}
```

**Response para usuario registrado:**
```json
{
  "success": true,
  "pregunta": "¿Cuál es el nombre de tu mascota favorita?"  // La pregunta que el usuario escogió
}
```

**Response para usuario de Google:**
```json
{
  "success": false,
  "statusCode": 404,
  "message": "Este correo está asociado a una cuenta de Google. No se puede usar recuperación de contraseña por pregunta de seguridad. Usa 'Continuar con Google' para iniciar sesión."
}
```

---

### Para REGISTRO (mostrar lista de preguntas disponibles)

**Endpoint:** `GET /api/pregunta-seguridad`

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "pregunta-1", "pregunta": "¿Cuál es el nombre de tu mascota favorita?" },
    { "id": "pregunta-2", "pregunta": "¿En qué ciudad naciste?" }
    // ... más preguntas
  ]
}
```

⚠️ **Este endpoint NO es para recuperación de contraseña**, solo para mostrar opciones al registrar.

---

## 🔍 Cómo Funciona

### Usuario Registrado (con email/password):
1. Al registrarse, elige una pregunta de las disponibles
2. La pregunta se guarda en `usuarios.pregunta_seguridad`
3. La respuesta se guarda hasheada en `usuarios.respuesta_seguridad`
4. Al recuperar contraseña, se consulta `POST /api/usuarios/pregunta-seguridad` que devuelve SU pregunta específica

### Usuario de Google:
1. NO elige pregunta al registrarse (solo hace clic en "Continuar con Google")
2. `usuarios.pregunta_seguridad` = `NULL`
3. Al intentar recuperar contraseña, el endpoint devuelve error indicando que es cuenta de Google

---

## 📝 Verificar en Base de Datos

Para verificar que un usuario tiene pregunta guardada:

```sql
SELECT 
  email, 
  googleId,
  pregunta_seguridad,
  CASE 
    WHEN googleId IS NOT NULL THEN 'Usuario de Google'
    WHEN pregunta_seguridad IS NOT NULL THEN 'Tiene pregunta'
    ELSE 'Sin pregunta'
  END as estado
FROM usuarios;
```

---

## 🚨 Solución de Problemas

### Usuario de Google ve pregunta:
- **Causa**: El frontend está usando `GET /api/pregunta-seguridad` (preguntas disponibles) en lugar de `POST /api/usuarios/pregunta-seguridad`
- **Solución**: Cambiar el frontend para usar el endpoint correcto

### Usuario registrado NO ve su pregunta:
- **Causa 1**: La pregunta no se guardó en la BD
- **Causa 2**: El frontend está usando el endpoint incorrecto
- **Solución**: 
  1. Verificar en BD que el usuario tiene `pregunta_seguridad`
  2. Verificar que el frontend usa `POST /api/usuarios/pregunta-seguridad`

---

## ✅ Endpoint Correcto para Frontend

**En la pantalla de recuperación de contraseña, el frontend debe:**

1. Pedir el email al usuario
2. Llamar a: `POST /api/usuarios/pregunta-seguridad` con `{ "email": "..." }`
3. Mostrar la pregunta que devuelve el endpoint
4. Si es usuario de Google, mostrar el mensaje de error

**NO debe usar:** `GET /api/pregunta-seguridad` (ese es solo para el formulario de registro)

