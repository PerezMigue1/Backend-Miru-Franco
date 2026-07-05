# VERIFICACIÓN HTTP EXHAUSTIVA — Backend Miru Franco

> Fecha: 2026-07-05 · Ejecutado con curl real contra `http://localhost:3001/api` · Token JWT de admin (`egiptorusa@gmail.com`, rol `admin`).
> Todos los status codes son los **realmente recibidos**. Endpoints negativos (solapamiento, stock insuficiente) se marcan ✅ cuando devuelven el error esperado.

## Resumen

| Módulo | Endpoints probados | ✅ | ❌ |
|--------|--------------------|----|----|
| 1 — Usuarios / Roles / Permisos / Empleados | 16 | 16 | 0 |
| 2 — Clientes / Quejas / Seguimientos | 14 | 14 | 0 |
| 3 — Servicios / Citas | 18 | 18 | 0 |
| 4 — POS / Ventas / Cortes | 9 | 9 | 0 |
| 5 — Inventario | 9 | 9 | 0 |
| **Total** | **66** | **66** | **0** |
| Seguridad | 3 checks | 2 ✅ + 1 no ejecutable | — |

**Todos los endpoints funcionales respondieron OK.** Se encontró **1 bug menor** de manejo de error (PUT usuario inexistente → 500 en vez de 404). Ningún bug crítico.

---

## Módulo 1 — Usuarios / Roles / Permisos / Empleados

| Método | Ruta | Status | ✅/❌ | Nota |
|--------|------|--------|-------|------|
| GET | /usuarios | 200 | ✅ | Sin leakage (ver seguridad) |
| GET | /usuarios/roles | 200 | ✅ | Devuelve los 5 roles (admin, estilista, empleado, becario, cliente) |
| GET | /usuarios/:id | 200 | ✅ | |
| GET | /usuarios/:id/perfil | 200 | ✅ | |
| PUT | /usuarios/:id | 200 | ✅ | Con `tipoCabello`+`alergias` → **NO da 400** (fix MM4 confirmado) |
| PATCH | /usuarios/:id/rol | 200 | ✅ | cliente↔estilista |
| PATCH | /usuarios/:id/estado | 200 | ✅ | |
| GET | /permisos | 200 | ✅ | 5 roles del seed |
| GET | /permisos/rol/estilista | 200 | ✅ | |
| GET | /permisos/rol/becario | 200 | ✅ | Clave correcta `becario` (no `becado`); claves: `["citas:asignadas","servicios:lectura","clientes:lectura"]` |
| PUT | /permisos/rol/estilista | 200 | ✅ | Actualizado y **revertido** al valor original |
| GET | /empleados | 200 | ✅ | |
| POST | /empleados | 201 | ✅ | Creado sobre usuario con rol estilista |
| GET | /empleados/:usuarioId | 200 | ✅ | |
| PUT | /empleados/:usuarioId | 200 | ✅ | |
| DELETE | /empleados/:usuarioId | 200 | ✅ | **Soft-delete**: tras DELETE, GET devuelve el registro con `activo:false` (no borrado físico) |

## Módulo 2 — Clientes / Quejas / Seguimientos

| Método | Ruta | Status | ✅/❌ | Nota |
|--------|------|--------|-------|------|
| GET | /clientes | 200 | ✅ | Sin leakage |
| GET | /clientes/:id | 200 | ✅ | |
| GET | /clientes/:id/historial-compras | 200 | ✅ | |
| GET | /clientes/:id/historial-citas | 200 | ✅ | |
| GET | /quejas | 200 | ✅ | |
| POST | /quejas | 201 | ✅ | queja #2 |
| GET | /quejas/:id | 200 | ✅ | |
| GET | /quejas/cliente/:clienteId | 200 | ✅ | |
| PUT | /quejas/:id | 200 | ✅ | estado→resuelta; **`resueltaEn` auto-asignado** (`2026-07-05T22:10:52Z`) |
| GET | /seguimientos | 200 | ✅ | |
| POST | /seguimientos | 201 | ✅ | seguimiento #1 |
| GET | /seguimientos/:id | 200 | ✅ | |
| GET | /seguimientos/cliente/:clienteId | 200 | ✅ | |
| PUT | /seguimientos/:id | 200 | ✅ | (método PUT correcto, no PATCH) |

## Módulo 3 — Servicios / Citas

| Método | Ruta | Status | ✅/❌ | Nota |
|--------|------|--------|-------|------|
| GET | /servicios | 200 | ✅ | |
| GET | /servicios/:id | 200 | ✅ | |
| POST | /servicios | 201 | ✅ | servicio #96 |
| PUT | /servicios/:id | 200 | ✅ | |
| DELETE | /servicios/:id | 200 | ✅ | Eliminó el #96 creado |
| GET | /citas | 200 | ✅ | |
| GET | /citas?desde=&hasta= | 200 | ✅ | Filtros de rango |
| GET | /citas/dia?fecha= | 200 | ✅ | |
| GET | /citas/calendario?desde=&hasta= | 200 | ✅ | |
| POST | /citas | 201 | ✅ | cita #11 (A) |
| POST | /citas (solapada) | **400** | ✅ | **Rechazada**: "El especialista ya tiene una cita en ese horario" |
| POST | /citas | 201 | ✅ | cita #12 (C) |
| GET | /citas/:id | 200 | ✅ | |
| PATCH | /citas/:id | 200 | ✅ | Editar notas |
| PATCH | /citas/:id/check-in | 200 | ✅ | estado→`en_curso` |
| PATCH | /citas/:id/check-out | 200 | ✅ | estado→`completada` |
| PATCH | /citas/:id/reprogramar | 200 | ✅ | estado→`reprogramada` |
| PATCH | /citas/:id/cancelar | 200 | ✅ | estado→`cancelada` |
| POST | /citas/:id/materiales | 201 | ✅ | Body `{materiales:[{presentacionId,cantidad}]}`; **descuenta inventario** (stock #3: 8→7) |

## Módulo 4 — POS / Ventas / Cortes

| Método | Ruta | Status | ✅/❌ | Nota |
|--------|------|--------|-------|------|
| GET | /pos/ventas | 200 | ✅ | |
| GET | /pos/resumen | 200 | ✅ | |
| POST | /pos/ventas (producto) | 201 | ✅ | venta #5, folio `VL-2026-000005`; **stock #3: 7→5** |
| POST | /pos/ventas (servicioId) | 201 | ✅ | venta #6 (servicio); **stock #3 sin cambio (5)** — no toca inventario |
| GET | /pos/ventas/:id | 200 | ✅ | |
| PATCH | /pos/ventas/:id/cancelar | 200 | ✅ | Cancela venta #5; **stock #3: 5→7 (revertido)** |
| GET | /pos/cortes | 200 | ✅ | |
| POST | /pos/cortes | 201 | ✅ | corte #1 (`{fecha, efectivoInicial:1000, efectivoFinal:1500}`) |
| GET | /pos/cortes/:id | 200 | ✅ | |

## Módulo 5 — Inventario

| Método | Ruta | Status | ✅/❌ | Nota |
|--------|------|--------|-------|------|
| GET | /inventario/movimientos | 200 | ✅ | |
| POST | /inventario/entradas | 201 | ✅ | stock #3: 7→12 (+5) |
| POST | /inventario/salidas | 201 | ✅ | stock #3: 12→9 (-3) |
| POST | /inventario/salidas (insuficiente) | **400** | ✅ | Pidió 99999; **rechazada** "Stock insuficiente" |
| POST | /inventario/ajustes | 201 | ✅ | `stockReal:10` → stock #3 = 10 |
| POST | /inventario/conteo-fisico | 201 | ✅ | Body `{items:[{presentacionId,stockReal}]}`; stock #3 = 8 |
| GET | /inventario/alertas-stock?umbral=5 | 200 | ✅ | |
| GET | /inventario/caducidades?dias=30 | 200 | ✅ | |
| GET | /inventario/kardex/:presentacionId | 200 | ✅ | |

---

## Verificaciones de comportamiento (no solo status)

| Verificación | Resultado |
|--------------|-----------|
| ¿La cita solapada dio 400? | ✅ Sí — 400 "El especialista ya tiene una cita en ese horario (cita #11)" |
| ¿La venta descontó stock y la cancelación lo revirtió? | ✅ Sí — 7→5 al vender 2 uds; 5→7 al cancelar |
| ¿La venta de servicio NO tocó inventario? | ✅ Correcto — stock quedó igual |
| ¿La salida con stock insuficiente dio 400? | ✅ Sí |
| ¿`resueltaEn` se asignó solo al pasar a resuelta? | ✅ Sí — timestamp automático |
| ¿Materiales de cita descuentan inventario? | ✅ Sí — 8→7 |
| ¿Las respuestas de usuarios/clientes ocultan datos sensibles? | ✅ Sí — sin `password`, `codigoOTP`, `respuestaSeguridad`, `refreshToken` |

---

## Bugs encontrados

| # | Endpoint | Status recibido | Esperado | Severidad | Estado |
|---|----------|-----------------|----------|-----------|--------|
| B1 | `PUT /api/usuarios/:id` con id inexistente | **500** | 404 | 🟡 Menor | Documentado (no corregido) |

**B1 detalle:** `usuarios.service.ts → actualizarUsuario` hace `prisma.usuario.update({where:{id}})` sin verificar existencia previa; si el id no existe, Prisma lanza `P2025` que sale como 500 en lugar de un 404 limpio. No afecta el flujo normal (editar un usuario existente da 200). Fix trivial (envolver en try/catch o `findUnique` previo) pero toca lógica del service → **no lo corregí; ¿lo arreglo?**

> Nota operativa (no es bug de código): el `start:dev` de NestJS en Windows se cae ocasionalmente al recompilar (bug conocido `treeKillSync`/`taskkill` del watch mode). Durante la corrida un `PATCH /rol` dio un 404 transitorio justo en un recompile; al repetir dio 200. No es un fallo del endpoint.

---

## Pruebas de seguridad

| # | Prueba | Resultado |
|---|--------|-----------|
| 1 | Endpoint admin **sin token** (`GET /usuarios`, `GET /pos/ventas`) | ✅ **401** en ambos |
| 2 | Token de rol **cliente** → `GET /usuarios` debe dar 403 | ⚠️ **NO EJECUTADO** — no pude obtener un token de cliente: registrar un cliente funciona (201) pero el login exige activación por OTP (403 "cuenta no activada") y no puedo leer el correo ni el código (el backend no lo loguea). Evidencia indirecta: el `RolesGuard` consulta el rol en BD y bloquea con 403 los roles no listados; se confirmó que admin pasa, y en pruebas previas un rol sin permiso recibió 403 ("Solo admin puede actualizar quejas"). Para ejecutarlo de verdad necesito credenciales de un cliente ya verificado. |
| 3 | Leakage de datos sensibles en `GET /usuarios` y `GET /clientes` | ✅ **Sin leakage** — campos devueltos: id, nombre, email, telefono, fechaNacimiento, foto, googleId, tipoCabello, colorNatural, colorActual, productosUsados, alergias, aceptaAvisoPrivacidad, recibePromociones, confirmado, activo, creadoEn, actualizadoEn. **NO** aparecen password, codigoOTP, respuestaSeguridad ni tokens. |

---

## IDs / datos creados durante las pruebas (para que los borres tú)

> ⚠️ NO borré nada de la BD. Estos son los registros creados en esta corrida:

- **Quejas:** #2 (estado resuelta)
- **Seguimientos:** #1
- **Servicios:** #96 (ya **eliminado** vía DELETE durante la prueba)
- **Citas:** #11 (completada, con 1 material descontado), #12 (cancelada)
- **Ventas locales (POS):** #5 (cancelada), #6 (venta de servicio, pagada)
- **Cortes de caja:** #1
- **Perfil de empleado:** creado para el usuario `5f52565a-4ea0-4850-aabb-ab4cc4044171` y luego **soft-deleted** (`activo:false`)
- **Usuario de prueba** `5f52565a-4ea0-4850-aabb-ab4cc4044171`: se cambió su rol (cliente→estilista→cliente, **restaurado a cliente**) y se le pusieron `tipoCabello:"rizado"`, `alergias:"ninguna-test"`
- **Cliente registrado sin verificar:** `qatest_1783290138@example.com` (id `812c6b61-e03a-47b6-a1ab-4d8dbe450969`, activo pero sin activación OTP)
- **Cliente** `be0b896a-743c-4030-9553-41a8b7052ad0` ("mishu"): quedó con quejas/seguimientos de prueba asociados y perfil capilar de prueba
- **Inventario / presentación #3** (Shampoo Abbondanza): múltiples movimientos de kardex de prueba (entradas, salidas, ajuste, conteo, ventas y su reversión, materiales). Stock final = **8** (igual al inicial), pero el kardex tiene movimientos QA extra.

*(De la sesión de auditoría previa también quedaron: queja #1, ventas locales #3 y #4.)*

---

## Conteo final por módulo

- Módulo 1 (Usuarios/Roles/Permisos/Empleados): **16/16 ✅**
- Módulo 2 (Clientes/Quejas/Seguimientos): **14/14 ✅**
- Módulo 3 (Servicios/Citas): **18/18 ✅**
- Módulo 4 (POS/Ventas/Cortes): **9/9 ✅**
- Módulo 5 (Inventario): **9/9 ✅**
- **Total: 66/66 endpoints funcionales OK.** Seguridad: 401 ✅, leakage ✅, 403-por-rol pendiente de token cliente. Bugs: 1 menor (B1).
