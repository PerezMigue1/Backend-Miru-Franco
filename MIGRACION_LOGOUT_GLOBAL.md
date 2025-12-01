# 🔐 Guía: Migración para Logout Global

## 📋 Resumen

Esta migración agrega la funcionalidad de **logout global**, que permite cerrar todas las sesiones de un usuario desde cualquier dispositivo.

## 🎯 ¿Qué hace?

- **Logout individual**: Cierra solo la sesión del dispositivo actual (comportamiento anterior)
- **Logout global**: Cierra todas las sesiones del usuario en todos los dispositivos

## 📝 Cambios en la Base de Datos

Se agrega un nuevo campo `tokens_revocados_desde` en la tabla `usuarios` que almacena la fecha desde la cual todos los tokens anteriores están revocados.

## 🔧 Aplicar la Migración

### Opción 1: Desde Neon SQL Editor (Recomendado)

1. **Abre tu base de datos en Neon:**
   - Ve a https://console.neon.tech
   - Selecciona tu proyecto
   - Abre el **SQL Editor**

2. **Ejecuta el siguiente SQL:**
   ```sql
   -- Agregar columna para logout global
   ALTER TABLE "usuarios" 
   ADD COLUMN IF NOT EXISTS "tokens_revocados_desde" TIMESTAMP;

   -- Crear índice para mejorar rendimiento
   CREATE INDEX IF NOT EXISTS "idx_usuarios_tokens_revocados_desde" 
   ON "usuarios"("tokens_revocados_desde");
   ```

3. **Verificar que se aplicó correctamente:**
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'usuarios' 
   AND column_name = 'tokens_revocados_desde';
   ```

### Opción 2: Desde el archivo SQL

El archivo `prisma/migrations/add_tokens_revocados_desde.sql` contiene el SQL necesario. Puedes copiarlo y ejecutarlo en Neon.

## ✅ Verificar que Funciona

### 1. Probar Logout Individual

```bash
# 1. Iniciar sesión en dispositivo 1
POST /api/usuarios/login
{
  "email": "test@test.com",
  "password": "Password123"
}
# Guardar token1

# 2. Iniciar sesión en dispositivo 2
POST /api/usuarios/login
{
  "email": "test@test.com",
  "password": "Password123"
}
# Guardar token2

# 3. Cerrar sesión solo en dispositivo 1
POST /api/auth/logout
Authorization: Bearer <token1>
Body: { "logoutAll": false }  # o sin body (default)

# 4. Verificar que token1 está revocado
GET /api/auth/me
Authorization: Bearer <token1>
# Debe dar error 401 "Token revocado"

# 5. Verificar que token2 sigue funcionando
GET /api/auth/me
Authorization: Bearer <token2>
# Debe funcionar ✅
```

### 2. Probar Logout Global

```bash
# 1. Iniciar sesión en dispositivo 1
POST /api/usuarios/login
{
  "email": "test@test.com",
  "password": "Password123"
}
# Guardar token1

# 2. Iniciar sesión en dispositivo 2
POST /api/usuarios/login
{
  "email": "test@test.com",
  "password": "Password123"
}
# Guardar token2

# 3. Cerrar TODAS las sesiones desde dispositivo 1
POST /api/auth/logout-all
Authorization: Bearer <token1>
# O usar:
POST /api/auth/logout
Authorization: Bearer <token1>
Body: { "logoutAll": true }

# 4. Verificar que token1 está revocado
GET /api/auth/me
Authorization: Bearer <token1>
# Debe dar error 401 "Sesión cerrada"

# 5. Verificar que token2 también está revocado
GET /api/auth/me
Authorization: Bearer <token2>
# Debe dar error 401 "Sesión cerrada" ✅
```

## 🔌 Endpoints Disponibles

### 1. Logout Individual (Solo este dispositivo)
```http
POST /api/auth/logout
Authorization: Bearer <token>
Content-Type: application/json

{
  "logoutAll": false  // Opcional, default: false
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Sesión cerrada correctamente"
}
```

### 2. Logout Global (Todos los dispositivos)
```http
POST /api/auth/logout-all
Authorization: Bearer <token>
```

**O usando el endpoint de logout con parámetro:**
```http
POST /api/auth/logout
Authorization: Bearer <token>
Content-Type: application/json

{
  "logoutAll": true
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Todas las sesiones han sido cerradas correctamente"
}
```

## 💡 Cómo Funciona

1. **Al generar un token**: Se incluye `iat` (issued at time) en el payload del JWT
2. **Al hacer logout global**: Se actualiza `tokens_revocados_desde` en la base de datos con la fecha actual
3. **Al validar un token**: Se verifica si el `iat` del token es anterior a `tokens_revocados_desde`
   - Si es anterior → Token revocado (error 401)
   - Si es posterior → Token válido

## 🎨 Integración en el Frontend

### Ejemplo con Axios:

```jsx
// Logout individual (solo este dispositivo)
const logout = async () => {
  try {
    await api.post('/auth/logout', { logoutAll: false });
    // O simplemente:
    // await api.post('/auth/logout');
    localStorage.removeItem('token');
    router.push('/login');
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
  }
};

// Logout global (todos los dispositivos)
const logoutAll = async () => {
  try {
    await api.post('/auth/logout-all');
    // O usar:
    // await api.post('/auth/logout', { logoutAll: true });
    localStorage.removeItem('token');
    router.push('/login');
  } catch (error) {
    console.error('Error al cerrar todas las sesiones:', error);
  }
};
```

### Ejemplo de UI:

```jsx
function UserMenu() {
  return (
    <div>
      <button onClick={logout}>
        Cerrar sesión
      </button>
      <button onClick={logoutAll} style={{ color: 'red' }}>
        Cerrar todas las sesiones
      </button>
    </div>
  );
}
```

## ⚠️ Notas Importantes

1. **Tokens antiguos**: Los tokens emitidos antes de aplicar esta migración no tienen `iat`. Estos tokens seguirán funcionando hasta que expiren naturalmente.

2. **Rendimiento**: La verificación de logout global es muy eficiente (solo una consulta a la BD por petición autenticada).

3. **Compatibilidad**: El logout individual sigue funcionando como antes. El logout global es una funcionalidad adicional.

## 🐛 Troubleshooting

### Error: "Column tokens_revocados_desde does not exist"
- **Solución**: Ejecuta la migración SQL en Neon

### Los tokens antiguos siguen funcionando después de logout global
- **Causa**: Los tokens emitidos antes de la migración no tienen `iat`
- **Solución**: Espera a que expiren naturalmente, o fuerza a los usuarios a iniciar sesión nuevamente

### El logout global no funciona
- **Verifica**: Que el campo `tokens_revocados_desde` existe en la BD
- **Verifica**: Que los tokens nuevos incluyen `iat` (después de la migración)

## ✅ Checklist

- [ ] Ejecutar migración SQL en Neon
- [ ] Verificar que el campo existe en la BD
- [ ] Probar logout individual
- [ ] Probar logout global
- [ ] Actualizar frontend para usar los nuevos endpoints
- [ ] Documentar en el frontend cómo usar logout global

¡Listo! 🎉

