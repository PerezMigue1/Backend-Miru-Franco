# Handoff — Refactor Backend NestJS

**Fecha**: 2026-06-06  
**Repo**: `c:\Users\Miguel Angel\backend-miru`

---

## Objetivo

Limpiar y reorganizar el backend NestJS en tres puntos concretos:

1. Eliminar endpoints de registro duplicados
2. Separar responsabilidades entre `/auth` y `/usuarios`
3. Estandarizar el contrato de respuestas (eliminar `_id`, consistencia de claves)

---

## Estado actual

**Los 3 cambios completaron exitosamente.** `tsc --noEmit` sin errores.

El frontend **aún no está actualizado** para consumir las rutas nuevas de `/auth` — ese paso queda pendiente.

---

## Archivos en los que se ha trabajado

| Archivo | Tipo de cambio |
|--------|---------------|
| `src/auth/auth.controller.ts` | 10 endpoints nuevos + imports de DTOs y RateLimitGuard |
| `src/auth/auth.service.ts` | 10 métodos delegados a UsuariosService + fix `_logoutAll` |
| `src/usuarios/usuarios.controller.ts` | 2 endpoints duplicados eliminados + 10 endpoints movidos a /auth + imports limpiados |
| `src/usuarios/usuarios.service.ts` | `_id` eliminado de `crearUsuario()` y `login()`, clave `data` → `usuario`, import `isCommonAnswer` eliminado |
| `src/pregunta-seguridad/pregunta-seguridad.service.ts` | `_id` → `id` en respuesta, prefijo `_` en parámetros de métodos stub |

---

## Qué ha cambiado

### Rutas de registro — de 3 a 1

```
❌ POST /api/usuarios           → eliminado
❌ POST /api/usuarios/registrar → eliminado
✅ POST /api/usuarios/registro  → único endpoint que queda
```

### Reorganización auth / usuarios

Estos endpoints se movieron de `/usuarios` a `/auth`:

| Antes | Ahora |
|-------|-------|
| `POST /api/usuarios/login` | `POST /api/auth/login` |
| `POST /api/usuarios/verificar-otp` | `POST /api/auth/verificar-otp` |
| `POST /api/usuarios/reenviar-codigo` | `POST /api/auth/reenviar-codigo` |
| `POST /api/usuarios/pregunta-seguridad` | `POST /api/auth/pregunta-seguridad` |
| `POST /api/usuarios/verificar-respuesta` | `POST /api/auth/verificar-respuesta` |
| `POST /api/usuarios/solicitar-enlace-recuperacion` | `POST /api/auth/solicitar-enlace-recuperacion` |
| `POST /api/usuarios/enviar-codigo-recuperacion-sms` | `POST /api/auth/enviar-codigo-recuperacion-sms` |
| `POST /api/usuarios/verificar-codigo-recuperacion-sms` | `POST /api/auth/verificar-codigo-recuperacion-sms` |
| `POST /api/usuarios/validar-token-recuperacion` | `POST /api/auth/validar-token-recuperacion` |
| `POST /api/usuarios/cambiar-password` | `POST /api/auth/cambiar-password` |

`/usuarios` ahora es CRUD puro: listar, obtener, actualizar, cambiar rol/estado, eliminar.

### Contrato de respuestas

**`crearUsuario()`** — antes:
```json
{ "success": true, "data": { "id": "...", "_id": "...", "nombre": "..." } }
```
Ahora:
```json
{ "success": true, "usuario": { "id": "...", "nombre": "..." } }
```

**`login()`** — antes:
```json
{ "usuario": { "id": "...", "_id": "...", "nombre": "..." } }
```
Ahora:
```json
{ "usuario": { "id": "...", "nombre": "..." } }
```

**`obtenerPreguntaPorEmail()`**: `_id` → `id` en el objeto `data[]`.

---

## Qué ha fallado

Nada en el backend. Los warnings de LSP que aparecieron durante los edits eran diagnósticos **stale** — el hook PostToolUse captura el estado antes de que el language server re-analice el archivo. La compilación `tsc --noEmit` al final confirmó cero errores reales.

---

## Qué se ha intentado

- Plan presentado y confirmado antes de tocar cualquier archivo
- Cambio 1 verificado con `grep @Post` sobre el controller
- Cambio 2 verificado con `grep _id` sobre todo `/src` para asegurar que no quedó ninguno en respuestas de API
- Cambio 3 ejecutado en tres pasos: controller auth → service auth → limpiar controller usuarios
- `tsc --noEmit` como verificación final

---

## Qué falta por hacer

### Crítico — el frontend romperá si no se actualiza

Actualizar `src/app/services/auth.ts` en el frontend (`miru-franco-web`) para reemplazar las rutas viejas:

```
/api/usuarios/login                             → /api/auth/login
/api/usuarios/verificar-otp                     → /api/auth/verificar-otp
/api/usuarios/reenviar-codigo                   → /api/auth/reenviar-codigo
/api/usuarios/pregunta-seguridad                → /api/auth/pregunta-seguridad
/api/usuarios/verificar-respuesta               → /api/auth/verificar-respuesta
/api/usuarios/solicitar-enlace-recuperacion     → /api/auth/solicitar-enlace-recuperacion
/api/usuarios/enviar-codigo-recuperacion-sms    → /api/auth/enviar-codigo-recuperacion-sms
/api/usuarios/verificar-codigo-recuperacion-sms → /api/auth/verificar-codigo-recuperacion-sms
/api/usuarios/validar-token-recuperacion        → /api/auth/validar-token-recuperacion
/api/usuarios/cambiar-password                  → /api/auth/cambiar-password
```

### Pendiente de verificar

El frontend podría estar llamando estas rutas **sin el sufijo `-sms`**:
- `POST /auth/enviar-codigo-recuperacion`
- `POST /auth/verificar-codigo-recuperacion`

Esos endpoints **no existen** en el backend — solo existen con `-sms`. Revisar `src/app/services/auth.ts` y alinear un lado con el otro.

### Deseable (no urgente)

- Revisar si hay colecciones de Postman, tests e2e o scripts que llamen las rutas viejas de `/usuarios`
- El `crearUsuario()` ahora devuelve `usuario` en vez de `data` — verificar si algún componente del frontend consume esa clave directamente
