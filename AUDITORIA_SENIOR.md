# AUDITORÍA SENIOR — Backend Miru Franco (NestJS + Prisma + PostgreSQL/Neon)

> Fecha: 2026-07-02 · Fase: verificación real de funcionamiento (pre-producción)
> Metodología: nada se marca "funciona" sin evidencia (comando corrido / prueba ejecutada).

---

## 1. Resumen ejecutivo

- **¿Compila?** ✅ Sí. `npm run build` (prisma generate + tsc) y `tsc --noEmit` → exit 0, sin errores.
- **¿Arranca?** ✅ Sí. `npm run start:dev` levanta, conecta a Prisma/Neon y registra las rutas de los 8 módulos.
- **Bugs críticos encontrados:** **1** (doble prefijo `/api/api` en `citas` y `pos` → 404 desde el frontend). **CORREGIDO en esta sesión.**
- **Bugs importantes (integridad de datos):** 2 (atomicidad POS + materiales de cita fuera de transacción). **Pendientes de tu decisión** (tocan lógica de negocio).
- **Veredicto backend:** con el fix de ruteo aplicado, el backend **compila, arranca y expone correctamente los 8 módulos**. Quedan 2 mejoras de integridad recomendadas antes de producción, pero no bloquean la fase de diseño.

---

## 2. Tabla de resultados por fase

| Fase | Comando | Resultado |
|------|---------|-----------|
| 0 | Existencia de `.env` | ✅ Presente, todas las variables pobladas (DATABASE_URL, JWT_SECRET, TWILIO, SENDGRID, GOOGLE, FRONTEND_URL, PORT, DD_*) |
| 0 | `npm install` | ✅ OK, sin errores de peer deps. `postinstall` corre `prisma generate`. ⚠️ `npm audit`: 19 vulnerabilidades (9 high, 7 moderate, 3 low) — heredadas de deps, no bloquean |
| 1.1 | `npm run build` / `tsc --noEmit` | ✅ exit 0, sin errores TypeScript |
| 1.2 | `npx prisma validate` | ✅ "The schema is valid 🚀" |
| 1.2 | `npx prisma migrate status` | ✅ "Database schema is up to date!" — 9 migraciones, ninguna pendiente |
| 1.2 | Verificación 8 modelos | ✅ Los 8 existen en schema y en migraciones (ver tabla abajo) |
| 1.3 | `npm run start:dev` | ✅ "Nest application successfully started", "Prisma conectado a PostgreSQL", puerto 3001 |
| 1.3 | Rutas de los 8 módulos | ✅ Todas registradas (tras corregir el doble prefijo) |

### Mapeo modelo → tabla → migración

| Modelo | Tabla | Migración |
|--------|-------|-----------|
| PerfilEmpleado | `perfiles_empleado` | 20260613000100 ✅ |
| PermisoRol | `permisos_rol` | 20260613000100 ✅ |
| Queja | `quejas` | 20260613000200 ✅ |
| SeguimientoPostServicio | `seguimientos_post_servicio` | 20260613000200 ✅ |
| Cita | `citas` | 20260613000300 ✅ |
| VentaLocal | `ventas_local` | 20260613000400 ✅ |
| VentaLocalItem | `ventas_local_items` | 20260613000400 ✅ |
| CorteCaja | `cortes_caja` | 20260613000400 ✅ |

---

## 3. Bugs encontrados (priorizados)

### 🔴 CRÍTICO

| # | Archivo:línea | Descripción |
|---|---------------|-------------|
| C1 | `src/citas/citas.controller.ts:23`, `src/pos/pos.controller.ts:22` | **Doble prefijo `/api/api`.** Ambos controladores declaraban `@Controller('api/citas')` / `@Controller('api/pos')` mientras `main.ts:36` ya aplica `setGlobalPrefix('api')`. Las rutas efectivas quedaban en `/api/api/citas` y `/api/api/pos`. El frontend llama a `/api/citas` y `/api/pos` (verificado en `services/citas.ts` y `services/pos.ts`) → **todas las llamadas de Citas y POS devolvían 404**. Rompía: gestion-citas, agenda-calendario, atencion-sin-cita, ejecucion-servicios, venta-local, corte-de-caja. **CORREGIDO** (ver §4). |

### 🟠 IMPORTANTE (integridad de datos — pendientes de tu decisión, tocan lógica de negocio)

| # | Archivo:línea | Descripción |
|---|---------------|-------------|
| I1 | `src/pos/pos.service.ts:140-184` | **Venta y descuento de inventario NO son atómicos entre sí.** La venta + items se crean en `$transaction` (bien), pero las salidas de inventario ocurren DESPUÉS en un loop (paso 4, fuera de la transacción). Riesgos: (a) si `registrarSalida` falla en el ítem 2 de 3, la venta queda `pagada` con inventario parcialmente descontado; (b) el stock se pre-valida ANTES de la transacción → dos ventas concurrentes de la misma presentación pueden sobrevender. Cada `registrarSalida` sí es transaccional individualmente, pero el conjunto venta+inventario no. |
| I2 | `src/citas/citas.service.ts:344-357` | **`registrarMateriales` descuenta inventario en un loop sin transacción.** Si falla a mitad, quedan salidas parciales aplicadas y otras no. Mismo patrón que I1. |

### 🟡 MENOR (calidad / smell — no bloquean)

| # | Archivo:línea | Descripción |
|---|---------------|-------------|
| M1 | `src/pos/pos.controller.ts:24` | `@Permisos('ventas:escritura')` a nivel de clase aplica a los GET de lectura (listar ventas, cortes, resumen). Leer POS requiere permiso de escritura. Por diseño hoy solo `empleado`/`admin` acceden, pero es un smell (lectura pidiendo permiso de escritura). |
| M2 | `prisma/seed.ts:8-11` vs `citas.controller.ts` | Inconsistencia de nombres de clave: estilista tiene `citas:propias` (plural) y cliente `citas:propia` (singular). Los controladores listan AMBAS variantes en `@Permisos(...)`, así que funciona, pero la duplicación es frágil: un endpoint nuevo que olvide una variante bloqueará un rol silenciosamente. |
| M3 | `src/citas/citas.controller.ts:62` | `crear` requiere `citas:escritura` o `citas:propia`. El estilista (solo `citas:propias`) **no puede crear** citas. Probablemente intencional (crean admin/empleado/cliente), pero conviene confirmarlo. |
| M4 | `src/main.ts:84` | CORS: en la rama de origen no permitido hace `callback(null, true)` con comentario "Permitir todos temporalmente para debugging". En producción esto anula la allow-list. |

---

## 4. Bugs corregidos en esta sesión

| # | Fix | Diff resumido |
|---|-----|---------------|
| C1 | Eliminado el prefijo `api/` redundante en los 2 controladores | `citas.controller.ts`: `@Controller('api/citas')` → `@Controller('citas')`<br>`pos.controller.ts`: `@Controller('api/pos')` → `@Controller('pos')` |

**Verificación del fix:** tras el hot-reload, el log de arranque muestra `Mapped {/api/citas, GET}`, `Mapped {/api/pos/ventas, POST}`, etc. (prefijo simple correcto). Contrato ahora coincide con lo que envía el frontend.

---

## 5. Bugs pendientes que requieren tu decisión

- **I1 (atomicidad POS):** para hacerlo atómico habría que mover el descuento de inventario DENTRO del `$transaction` de la venta (o hacer que `crearVenta` reciba un `tx` y llame a una variante transaccional de `registrarSalida`). Toca lógica de negocio → **requiere tu OK.**
- **I2 (materiales de cita):** mismo enfoque, envolver el loop en `$transaction`.
- **npm audit (9 high):** ¿quieres que evalúe `npm audit fix` (no `--force`)? Puede cambiar versiones de deps.

Ninguno de estos bloquea la fase de diseño, pero I1/I2 sí deberían resolverse antes de producción real de ventas.

---

## 6. Auditoría de código senior — checklist por criterio

| Criterio | Resultado |
|----------|-----------|
| **Transacciones** | ✅ Lecturas paginadas usan `$transaction([count, findMany])`. ✅ `crearVenta` y `crearCorte` usan `$transaction` para escrituras multi-tabla. ✅ `inventario.registrarEntrada/Salida` cada una transaccional. ⚠️ Venta↔inventario y materiales↔inventario NO atómicos (I1, I2). |
| **Validación (DTOs)** | ✅ `ValidationPipe` global con `whitelist: true` + `forbidNonWhitelisted: true` (`main.ts:137`). ✅ DTOs con `class-validator` (verificado `create-venta.dto.ts`: `@IsInt`, `@Min`, `@IsUUID`, `@ValidateNested`, `@ArrayMinSize`). No se detectaron endpoints con body sin DTO en los 8 módulos. |
| **Manejo de errores** | ✅ Excepciones tipadas en todos los servicios (`NotFoundException`, `BadRequestException`, `ForbiddenException`, `ConflictException`). No se hallaron `throw new Error()` genéricos en los 8 módulos. |
| **N+1 queries** | 🟡 `crearVenta` y `registrarMateriales` hacen queries dentro de loops (por ítem). Están acotados por el nº de ítems y son secuenciales por diseño (validación/descuento), no es un N+1 clásico de listado. Los listados usan `include`, sin N+1. |
| **Guards** | ✅ Todos los controladores de los 8 módulos usan `@UseGuards(JwtAuthGuard, PermisosGuard)` con `@Permisos(...)` por endpoint. No se halló endpoint sensible sin guard. |
| **Leakage de Usuario** | ✅ Ningún endpoint devuelve el `Usuario` completo. Todas las relaciones usan `select` acotado (id, nombre, email, rol, foto/telefono). Sin exposición de `password`/`otp`/tokens. |
| **Scope por rol (citas)** | ✅ **Implementado de verdad** en el service: `aplicarScope()` filtra `especialistaId === usuarioId` para estilista/empleado/becario y `clienteId === usuarioId` para cliente; se aplica en listar/listarDia/listarCalendario/obtener. El `PermisosGuard` adjunta `request.rolUsuario` y el controller lo pasa al service. Verificado por código. |
| **Auto-resolución de quejas** | ✅ `quejas.service.ts:126-128`: al pasar a `resuelta`/`cerrada` sin `resueltaEn`, asigna `new Date()` automáticamente. |
| **Seed de permisos** | ✅ `prisma/seed.ts` upserta los 5 roles con sus claves; `update: {}` no sobrescribe claves personalizadas existentes. |

---

## 7. Estado de flujos E2E (se detallan en VERIFICACION_E2E.md del frontend)

Pendiente Fase 3. La verificación de rutas y de lógica de servicio hecha aquí habilita las pruebas E2E; los descuentos de inventario (I1/I2) deben observarse con datos reales.

---

## 8. Veredicto backend

**El backend compila, arranca y expone correctamente los 8 módulos nuevos tras corregir el bug crítico de ruteo (C1).** El diseño de guards, permisos, scope por rol, validación y no-leakage es sólido. Quedan 2 mejoras de integridad transaccional (I1, I2) recomendadas antes de producción de ventas, pero **no bloquean el paso a la fase de diseño/responsividad**.
