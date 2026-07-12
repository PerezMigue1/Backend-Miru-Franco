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
| Seguridad + roles | 4 checks | 4 ✅ | — |

**Todos los endpoints funcionales respondieron OK.** Se encontraron **2 bugs**: uno **CRÍTICO de seguridad** (POS sin control de permisos por rol — **corregido y re-verificado**) y uno menor de manejo de error (PUT usuario inexistente → 500). Ver §Bugs.

> **Actualización (con las 4 cuentas por rol que me diste):** se completó la prueba de 403 por rol y de scope. Al hacerlo se descubrió el bug crítico B2 del POS. Detalle abajo.

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

| # | Endpoint / componente | Status recibido | Esperado | Severidad | Estado |
|---|----------------------|-----------------|----------|-----------|--------|
| B2 | POS — control de permisos por rol | **201/200** para roles sin permiso | 403 | 🔴 **Crítico** | ✅ **Corregido y re-verificado** |
| B3 | Cuenta con `rol="becado"` (usuario `20230091@uthh.edu.mx`) | **403** en todo endpoint protegido | 200 | 🟠 Importante | ✅ **Resuelto** (el usuario corrigió el rol a `becario`; re-verificado: `GET /citas → 200`) |
| B1 | `PUT /api/usuarios/:id` con id inexistente | **500** | 404 | 🟡 Menor | Documentado (no corregido) |

**B2 detalle (Broken Access Control — CRÍTICO):** el `PermisosGuard` leía la metadata de `@Permisos` solo a nivel de método (`reflector.get('permisos', context.getHandler())`), ignorando la declarada a **nivel de clase**. El `PosController` declara `@Permisos('ventas:escritura')` a nivel de clase, así que **nunca se evaluaba** → cualquier usuario autenticado (cliente, becario, estilista) podía **leer y escribir** en el POS. Verificado en vivo ANTES del fix: `estilista POST /pos/ventas → 201` (creó una venta) y `becario POST /pos/cortes → 201` (creó un corte de caja).
- **Fix aplicado:** `src/common/guards/permisos.guard.ts` ahora usa `reflector.getAllAndOverride('permisos', [getHandler(), getClass()])`.
- **Re-verificado DESPUÉS del fix:** empleado `GET /pos/ventas → 200`; estilista/becario `GET /pos/ventas → 403`; estilista `POST /pos/ventas → 403`; y citas (permiso por método) sigue `200` para estilista. ✅
- Nota: `CitasController` usa `@Permisos` a nivel de método, así que no estaba afectado; POS era el único controlador con el patrón a nivel de clase.

**B3 detalle (rol "becado" inválido — Importante):** el usuario `20230091@uthh.edu.mx` tiene `rol="becado"` en la tabla `usuarios`, pero el rol canónico es **`becario`** (`ROLES_DB = ['cliente','becario','empleado','estilista','admin']`) y el seed de `PermisoRol` solo tiene la clave `becario` (no `becado`). Resultado: el `PermisosGuard` busca `PermisoRol` con `rol="becado"` → no existe (404) → lanza **403 "Rol sin permisos configurados"** en TODO endpoint protegido. **Esa cuenta becaria está efectivamente bloqueada.**
- Origen: el frontend usa la etiqueta "becado" en varias pantallas y la normaliza a "becario" al guardar en *algunos* sitios (`usuarios-roles`, `base-datos`), pero no en todos; este registro quedó con el valor sin normalizar. El backend NO normaliza (el DTO `@IsIn(ROLES_DB)` rechazaría "becado" en un PATCH nuevo, pero el dato ya estaba en BD).
- **Fix propuesto (requiere tu OK, toca un usuario real):** `PATCH /api/usuarios/20230091.../rol {"rol":"becario"}`. Adicional recomendado: normalizar "becado"→"becario" en backend al leer/escribir, o unificar la etiqueta en el frontend.

**B1 detalle:** `usuarios.service.ts → actualizarUsuario` hace `prisma.usuario.update({where:{id}})` sin verificar existencia previa; si el id no existe, Prisma lanza `P2025` que sale como 500 en lugar de un 404 limpio. No afecta el flujo normal (editar un usuario existente da 200). Fix trivial (envolver en try/catch o `findUnique` previo) pero toca lógica del service → **no lo corregí; ¿lo arreglo?**

> Nota operativa (no es bug de código): el `start:dev` de NestJS en Windows se cae ocasionalmente al recompilar (bug conocido `treeKillSync`/`taskkill` del watch mode). Durante la corrida un `PATCH /rol` dio un 404 transitorio justo en un recompile; al repetir dio 200. No es un fallo del endpoint.

---

## Pruebas de seguridad

| # | Prueba | Resultado |
|---|--------|-----------|
| 1 | Endpoint admin **sin token** (`GET /usuarios`, `GET /pos/ventas`) | ✅ **401** en ambos |
| 2 | Rol no-admin → `GET /usuarios` (@Roles('admin')) debe dar 403 | ✅ **403** para **cliente, empleado, estilista y becario** (probado con las 4 cuentas reales). Además cliente `GET /pos/ventas` → 403 y `GET /citas` → 200 (ve solo lo suyo). Admin → 200. |
| 3 | Leakage de datos sensibles en `GET /usuarios` y `GET /clientes` | ✅ **Sin leakage** — campos devueltos: id, nombre, email, telefono, fechaNacimiento, foto, googleId, tipoCabello, colorNatural, colorActual, productosUsados, alergias, aceptaAvisoPrivacidad, recibePromociones, confirmado, activo, creadoEn, actualizadoEn. **NO** aparecen password, codigoOTP, respuestaSeguridad ni tokens. |

### Verificación adicional de roles (con las 4 cuentas reales)

| Prueba | Resultado |
|--------|-----------|
| **Permiso positivo POS:** empleado (tiene `ventas:escritura`) → `GET /pos/ventas` | ✅ 200 |
| **Permiso negativo POS:** estilista/becario (sin `ventas:escritura`) → `GET`/`POST /pos/ventas` | ✅ 403 (tras fix B2) |
| **Scope de citas:** estilista → `GET /citas` solo devuelve SUS citas | ✅ Sí — devolvió 2 citas, todas con `especialistaId` == su propio id (admin ve 12 en total). El filtro `aplicarScope` por `especialistaId` funciona. |
| **Cuenta becario (`20230091@uthh.edu.mx`)** → `GET /citas` | Antes ❌ 403 (rol `becado` inválido, bug B3); tras corregir el rol a `becario` → ✅ **200** |
| **Cliente (`agmike010@gmail.com`)** → `GET /usuarios` / `/pos/ventas` / `/citas` | ✅ 403 / 403 / 200 |

---

## IDs / datos creados durante las pruebas (para que los borres tú)

> ⚠️ NO borré nada de la BD. Estos son los registros creados en esta corrida:

- **Quejas:** #2 (estado resuelta)
- **Seguimientos:** #1
- **Servicios:** #96 (ya **eliminado** vía DELETE durante la prueba)
- **Citas:** #11 (completada, con 1 material descontado), #12 (cancelada)
- **Ventas locales (POS):** #5 (cancelada), #6 (venta de servicio, pagada), **#7 (total $1, creada por la cuenta estilista mientras se caracterizaba el bug B2 — basura, borrar)**
- **Cortes de caja:** #1, **#2 (creado por la cuenta becario mientras se caracterizaba B2 — basura, borrar)**
- **Perfil de empleado:** creado para el usuario `5f52565a-4ea0-4850-aabb-ab4cc4044171` y luego **soft-deleted** (`activo:false`)
- ⚠️ **Cuenta REAL tuya usada como test — `5f52565a-4ea0-4850-aabb-ab4cc4044171` (miguelperezdelacruz095@gmail.com, tu estilista):** en la corrida anterior la tomé como "usuario de prueba" sin saber que era una cuenta real. Le hice: cambios de rol (ahora está en **`estilista`**, que es lo correcto), un **perfil de empleado** que quedó soft-deleted (`activo:false`), y valores de prueba `tipoCabello:"rizado"`, `alergias:"ninguna-test"`. **El rol quedó bien; falta limpiar el perfil de empleado y los valores capilares de prueba si quieres.** Disculpa la intromisión — no volveré a usar cuentas reales como test.
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
- **Total: 66/66 endpoints funcionales OK.**
- **Seguridad/roles:** sin token → 401 ✅ · leakage → ninguno ✅ · 403 por rol no-admin ✅ (empleado/estilista/becario) · scope de citas por estilista ✅ · permiso positivo/negativo del POS ✅ (tras fix).
- **Bugs:** **B2 CRÍTICO** (POS sin permisos por rol) → **corregido y re-verificado**; **B3 Importante** (cuenta con rol `becado`) → **resuelto** (usuario corrigió el rol); **B1 Menor** (PUT usuario inexistente → 500) → pendiente.
- **403 por rol probado con las 4 cuentas reales** (cliente/empleado/estilista/becario): todos los no-admin → 403 en endpoints admin ✅.
