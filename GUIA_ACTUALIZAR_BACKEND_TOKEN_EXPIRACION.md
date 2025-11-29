# 🔧 Guía: Actualizar Backend - Tiempo de Expiración de Token

## 📋 Información del Backend Actual

El backend está implementado en **NestJS con TypeScript y Prisma**.

**Estado actual:**
- ✅ Token de recuperación expira en **15 minutos**
- ✅ Validación de contraseña diferente a la anterior **YA IMPLEMENTADA**
- ✅ Validación de complejidad de contraseña **YA IMPLEMENTADA**

---

## ✅ Cambio 1: Tiempo de Expiración del Token de Recuperación

### 🔍 Dónde Está el Código

El código está en:
- **Archivo:** `src/usuarios/usuarios.service.ts`
- **Método:** `validarRespuestaSeguridad()` (línea ~495)
- **Método:** `cambiarPassword()` (línea ~514)

### 📝 Código Actual (15 minutos)

**Archivo:** `src/usuarios/usuarios.service.ts`

**Línea ~497:**
```typescript
// Generar token temporal válido por 15 minutos
const token = crypto.randomBytes(32).toString('hex');
const resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
```

### ✅ Código a Cambiar (10 minutos)

**Opción 1: Cambiar directamente en el código**

```typescript
// ❌ ANTES (15 minutos)
const resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);

// ✅ DESPUÉS (10 minutos)
const resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
```

**Opción 2: Usar variable de entorno (Recomendado)**

1. **Agregar en `.env`:**
```env
RESET_TOKEN_EXPIRY_MINUTES=10
```

2. **Modificar el código:**
```typescript
// Al inicio del archivo o en el constructor
private readonly resetTokenExpiryMinutes = parseInt(
  process.env.RESET_TOKEN_EXPIRY_MINUTES || '10'
);

// En el método validarRespuestaSeguridad()
const resetPasswordExpires = new Date(
  Date.now() + this.resetTokenExpiryMinutes * 60 * 1000
);
```

### 🔍 Cómo Buscar en el Código

```bash
# Buscar en el backend:
grep -r "15 \* 60 \* 1000" src/
grep -r "resetPasswordExpires" src/
grep -r "validarRespuestaSeguridad" src/
```

### 📋 Código Completo a Modificar

#### 1. Generación del Token (Método: `validarRespuestaSeguridad`)

**Archivo:** `src/usuarios/usuarios.service.ts`  
**Línea:** ~495-505

```typescript
// ❌ ANTES (15 minutos)
async validarRespuestaSeguridad(email: string, respuesta: string) {
  // ... validación de respuesta ...
  
  // Generar token temporal válido por 15 minutos
  const token = crypto.randomBytes(32).toString('hex');
  const resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  
  await this.prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      resetPasswordToken: token,
      resetPasswordExpires,
    },
  });
  
  return {
    success: true,
    token,
    email: usuario.email,
  };
}
```

```typescript
// ✅ DESPUÉS (10 minutos)
async validarRespuestaSeguridad(email: string, respuesta: string) {
  // ... validación de respuesta ...
  
  // Generar token temporal válido por 10 minutos
  const token = crypto.randomBytes(32).toString('hex');
  const resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
  
  await this.prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      resetPasswordToken: token,
      resetPasswordExpires,
    },
  });
  
  return {
    success: true,
    token,
    email: usuario.email,
  };
}
```

#### 2. Validación del Token (Método: `cambiarPassword`)

**Archivo:** `src/usuarios/usuarios.service.ts`  
**Línea:** ~514-527

**Nota:** La validación ya está correcta. Prisma automáticamente verifica que `resetPasswordExpires > new Date()`, así que no necesitas cambiar nada aquí. El token se valida automáticamente cuando se busca el usuario.

```typescript
async cambiarPassword(email: string, token: string, nuevaPassword: string) {
  // Prisma automáticamente valida que resetPasswordExpires > new Date()
  const usuario = await this.prisma.usuario.findFirst({
    where: {
      email: email.toLowerCase(),
      resetPasswordToken: token,
      resetPasswordExpires: {
        gt: new Date(), // ✅ Ya valida automáticamente
      },
    },
  });

  if (!usuario) {
    throw new BadRequestException('Token inválido o expirado');
  }
  
  // ... resto del código ...
}
```

---

## ✅ Cambio 2: Validación de Contraseña Diferente a la Anterior

### ✅ Estado: YA IMPLEMENTADO

**¡Buenas noticias!** Esta validación **ya está implementada** en el backend.

**Archivo:** `src/usuarios/usuarios.service.ts`  
**Método:** `cambiarPassword()`  
**Línea:** ~529-535

```typescript
// ✅ YA IMPLEMENTADO
async cambiarPassword(email: string, token: string, nuevaPassword: string) {
  // ... validación del token ...
  
  // Validar que la nueva contraseña no sea igual a la anterior
  if (usuario.password) {
    const esMismaContraseña = await bcrypt.compare(nuevaPassword, usuario.password);
    if (esMismaContraseña) {
      throw new BadRequestException('La nueva contraseña no puede ser igual a la contraseña anterior');
    }
  }
  
  // ... resto del código ...
}
```

**No necesitas hacer nada aquí.** La validación ya está funcionando.

---

## 🎯 Checklist de Verificación

### Para el Cambio 1 (Tiempo de Expiración):

- [ ] Abrir archivo `src/usuarios/usuarios.service.ts`
- [ ] Buscar método `validarRespuestaSeguridad()` (línea ~495)
- [ ] Cambiar `15 * 60 * 1000` a `10 * 60 * 1000` (línea ~497)
- [ ] Actualizar comentario de "15 minutos" a "10 minutos"
- [ ] (Opcional) Agregar variable de entorno `RESET_TOKEN_EXPIRY_MINUTES=10`
- [ ] Verificar que la validación en `cambiarPassword()` funciona correctamente (ya está bien)

### Para el Cambio 2 (Contraseña Diferente):

- [x] ✅ **YA IMPLEMENTADO** - No necesitas hacer nada
- [x] ✅ Validación con `bcrypt.compare()` ya existe (línea ~531)
- [x] ✅ Error claro ya está implementado (línea ~533)
- [ ] Probar que funciona correctamente

---

## 🧪 Cómo Probar

### Probar Tiempo de Expiración (después de cambiar a 10 minutos):

1. Inicia el proceso de recuperación de contraseña:
   ```
   POST /api/usuarios/pregunta-seguridad
   { "email": "test@test.com" }
   ```

2. Responde la pregunta de seguridad:
   ```
   POST /api/usuarios/verificar-respuesta
   { "email": "test@test.com", "respuesta": "respuesta_correcta" }
   ```
   Obtendrás un token.

3. Espera 10 minutos (o modifica el tiempo en el código para probar más rápido)

4. Intenta cambiar la contraseña:
   ```
   POST /api/usuarios/cambiar-password
   {
     "email": "test@test.com",
     "token": "token_obtenido",
     "nuevaPassword": "NewPassword123!"
   }
   ```

5. **Resultado esperado:** Error 400 con mensaje "Token inválido o expirado"

### Probar Contraseña Diferente (ya implementado):

1. Inicia sesión con una contraseña (ej: `Password123!`)

2. Inicia el proceso de recuperación y obtén el token

3. Intenta cambiar a la misma contraseña:
   ```
   POST /api/usuarios/cambiar-password
   {
     "email": "test@test.com",
     "token": "token_obtenido",
     "nuevaPassword": "Password123!"  // Misma contraseña
   }
   ```

4. **Resultado esperado:** Error 400 con mensaje "La nueva contraseña no puede ser igual a la contraseña anterior"

---

## 📝 Resumen de Cambios

| Cambio | Archivo | Línea | Estado | Acción Requerida |
|--------|---------|-------|--------|-----------------|
| Tiempo de expiración | `src/usuarios/usuarios.service.ts` | ~497 | ⚠️ Pendiente | Cambiar `15 * 60 * 1000` a `10 * 60 * 1000` |
| Validación contraseña diferente | `src/usuarios/usuarios.service.ts` | ~529-535 | ✅ Implementado | Ninguna - Ya funciona |

---

## 🔧 Pasos para Actualizar

### Paso 1: Cambiar Tiempo de Expiración

1. Abre `src/usuarios/usuarios.service.ts`
2. Ve a la línea ~497 (método `validarRespuestaSeguridad`)
3. Cambia:
   ```typescript
   // De esto:
   const resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
   
   // A esto:
   const resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
   ```
4. Actualiza el comentario:
   ```typescript
   // De: "Generar token temporal válido por 15 minutos"
   // A: "Generar token temporal válido por 10 minutos"
   ```

### Paso 2: Probar

1. Compila el proyecto: `npm run build`
2. Ejecuta las pruebas (ver sección "Cómo Probar" arriba)
3. Verifica que el token expire después de 10 minutos

---

## ⚠️ Importante

- **Sincronización**: El frontend y backend deben usar el mismo tiempo de expiración (10 minutos)
- **Validación de contraseña**: Ya está implementada, no necesitas hacer nada
- **Testing**: Prueba el cambio de tiempo de expiración después de implementarlo
- **Commit**: Después de hacer el cambio, haz commit y push:
  ```bash
  git add src/usuarios/usuarios.service.ts
  git commit -m "feat: Cambiar tiempo de expiración de token de recuperación de 15 a 10 minutos"
  git push
  ```

---

## 📚 Archivos Relacionados

- `src/usuarios/usuarios.service.ts` - Lógica de negocio
- `src/usuarios/usuarios.controller.ts` - Endpoints de la API
- `src/usuarios/dto/cambiar-password.dto.ts` - Validación de DTO
- `GUIA_RECUPERACION_PASSWORD_FRONTEND.md` - Guía del frontend

---

¿Necesitas ayuda para hacer el cambio? Puedo ayudarte paso a paso.

