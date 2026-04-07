# Contrato API e‑commerce (backend-miru)

Documento alineado al **código actual** (`src/ecommerce`, `src/payments`, `src/main.ts`).  
**Base:** `{API_URL}/api/...` (ej. `http://localhost:3001/api`).  
**JSON:** propiedades en **camelCase** (como Prisma/Nest las serializan).

---

## 1. OpenAPI / Swagger

**Hoy no está configurado** Swagger/OpenAPI en este repo (no hay `SwaggerModule`).  
Este archivo cumple el rol de contrato hasta que se añada un `openapi.yaml` generado o decoradores `@ApiProperty`.

### Validación global (`forbidNonWhitelisted`)

En `main.ts`, `ValidationPipe` usa:

- `whitelist: true` — elimina del body propiedades **no** declaradas en el DTO.
- `forbidNonWhitelisted: true` — si el cliente envía **cualquier** propiedad extra → **400** (“no permitida”).
- `transform: true` + `enableImplicitConversion: true` — casteos básicos (strings numéricos, etc.).

**Implicación para el front:** solo enviar campos que existan en el DTO de cada endpoint; nada de “campos por si acaso”.

---

## 2. Pedidos y líneas

### `POST /api/pedidos` (JWT)

**Body (`CreatePedidoDto`):**

| Campo | Obligatorio | Notas |
|--------|-------------|--------|
| `items` | Sí | Array, **mínimo 1** elemento |
| `direccionEnvioId` | No | UUID; debe pertenecer al **usuario del pedido**. Puede omitirse o ser `null` (ej. retiro en tienda). |
| `usuarioId` | No | Solo **admin** puede fijar pedido para otro usuario. |
| `estado` | No | Enum `EstadoPedido`; default **`borrador`**. |
| `notasCliente`, `moneda`, `metodoPago`, `referenciaPago` | No | Strings opcionales. |

**Cada elemento de `items` (`PedidoItemLineDto`):**

| Campo | Obligatorio | Tipo |
|--------|-------------|------|
| `productoId` | Sí | Entero ≥ 1 (el DTO lo exige; el **servidor** toma el producto canónico desde la presentación en BD) |
| `presentacionId` | Sí | Entero ≥ 1 |
| `cantidad` | Sí | Entero ≥ 1 |

**Solo lectura / calculados en servidor (no van en POST):**

- `subtotal`, `costoEnvio`, `impuestos`, `descuento`, `total` — recalculados en **`crear`** así:
  - `subtotal` = suma de subtotales de líneas (precio de catálogo × cantidad, con stock/disponibilidad validados).
  - En **`crear`**, `costoEnvio`, `impuestos` y `descuento` se fijan siempre en **0** (no hay lógica de envío/impuestos en ese paso).
  - `total` = `subtotal + costoEnvio + impuestos - descuento`.

**No existe** endpoint de “simular totales” o “preview checkout”. El front puede:

- Mostrar totales **estimados** sumando precios del catálogo + envío que defina la UI, y
- Tras `POST /api/pedidos`, usar los **totales devueltos** en `data` como fuente de verdad, o
- Pedir **`PUT /api/pedidos/:id`** (admin) para ajustar `costoEnvio`, `impuestos`, `descuento` y luego el cliente refresca el pedido.

### `PUT /api/pedidos/:id` (JWT)

**Cliente normal (no admin):** solo puede actualizar, entre otros, `direccionEnvioId`, `direccionTextoCompleta`, `notasCliente`, `moneda`, `metodoPago`, `referenciaPago`. **No** puede cambiar `estado`, `costoEnvio`, `impuestos`, `descuento`.

**Admin:** además puede `estado`, `costoEnvio`, `impuestos`, `descuento`. Si cambia `estado`, se registra fila en historial (`origen: api.actualizar_pedido_admin`).

### Estados del pedido (`EstadoPedido`)

Valores permitidos en schema:

`borrador` · `pendiente_pago` · `pagado` · `preparando` · `enviado` · `entregado` · `cancelado`

**Transiciones:** no hay máquina de estados en código; cualquier valor válido puede enviarse en **create** (si el DTO lo permite) o en **update** (solo admin). La UI debe seguir reglas de negocio acordadas (ej. no saltar de `cancelado` a `pagado` sin proceso).

### Ítems sueltos del pedido

- `GET/POST /api/pedidos/:pedidoId/items`
- `PUT/DELETE /api/pedidos/:pedidoId/items/:itemId`  

Body POST línea: `productoId`, `presentacionId`, `cantidad` (misma idea: servidor valida presentación y stock).

---

## 3. Pagos (registro en BD) — **no** es pasarela completa

El módulo **`/api/pagos`** es **CRUD de registros** `pagos` en PostgreSQL vinculados a un `pedidoId`. **No** implementa:

- creación de “preferencia” Mercado Pago / Stripe Checkout,
- redirect URLs,
- webhooks de pasarela,
- 3DS como flujo propio.

**Flujo recomendado para producción:**

1. Front (o BFF) integra SDK/pasarela y obtiene éxito/fallo + id de transacción.
2. Front llama **`POST /api/pagos`** con `pedidoId`, `monto`, `metodo`, `intentoNumero`, `proveedor`, `estado`, `referenciaExterna`, `payload`, etc.
3. Consulta: **`GET /api/pagos/pedido/:pedidoId`** o **`GET /api/pagos/:id`**.
4. Actualización: **`PATCH /api/pagos/:id`** (`estado`, `referenciaExterna`, `errorMensaje`, `pagadoEn`, `monto`, `payload`).

**`estado` (`EstadoPago`):** `pendiente` · `aprobado` · `rechazado` · `cancelado` · `reembolsado`

**3DS / segundo paso:** documentar en el doc de la **pasarela** elegida; este backend solo almacena el resultado que le envíes.

---

## 4. Carrito

**`POST /api/carrito`:** upsert por **`(usuarioId, presentacionId)`** (único en BD). Body: `productoId`, `presentacionId`, `cantidad`, opcional `precioReferencia`.

**`PUT /api/carrito/:id`:** body (`UpdateCarritoItemDto`) puede incluir cualquier subconjunto de:

- `cantidad` (entero ≥ 1)
- `activo` (boolean)
- `precioReferencia` (número ≥ 0 o `null`)

**`precioReferencia`:** opcional; **no** sustituye el precio oficial al crear el pedido. El servidor usa precios de **`producto_presentaciones`** al validar líneas del pedido. Sirve para mostrar en UI “precio cuando lo agregué” o comparar con el actual.

---

## 5. Direcciones y retiro en tienda

**Rutas:** `GET/POST/PUT/DELETE /api/direcciones-usuario` (todo JWT). Crear/editar está **soportado** desde API (ver DTOs en `src/ecommerce/direcciones-usuario/dto/`).

**Checkout sin envío a domicilio:**

- `direccionEnvioId` en **`POST /api/pedidos`** puede ser **`null`/omitido** si no hay dirección.
- No hay campo `retiroEnTienda: boolean` en el DTO del pedido. Convención práctica: usar **`notasCliente`** (y si hace falta **`direccionTextoCompleta`** vía `PUT`) para texto tipo “Retiro en tienda …”.
- Si no hay envío físico, **`/api/envios/pedido/:id`** puede devolver **lista vacía** — es comportamiento **normal**.

---

## 6. Envíos y seguimiento

**`GET /api/envios/pedido/:pedidoId`** (JWT): `{ success, count, data }` donde `data` es array de filas Prisma:

- `id`, `pedidoId`, `empresaEnvio`, `numeroGuia`, `estadoEnvio`, `fechaEnvio`, `fechaEntrega`, `notas`, `creadoEn`, `actualizadoEn`

**`estadoEnvio`:** `preparando` · `en_transito` · `entregado` · `fallido`

**UI:** lista vacía = sin envío registrado (retiro o aún no cargado en admin).

---

## 7. Postventa y auxiliares (rutas reales)

| Recurso | Base | Notas |
|---------|------|--------|
| Facturas | `/api/facturas` | `GET .../pedido/:pedidoId`, CRUD con JWT |
| Devoluciones | `/api/devoluciones` | `GET .../pedido/:pedidoId`, CRUD con JWT |
| Valoraciones | `/api/valoraciones` | `GET .../producto/:productoId` **público**; resto JWT |
| Notificaciones | `/api/notificaciones` | JWT; `POST` crear solo **admin** |
| Historial pedido | `/api/historial-estados-pedido` | `GET .../pedido/:pedidoId`, `POST` crear entrada |

Detalle de bodies: DTOs en cada carpeta bajo `src/ecommerce/<modulo>/dto/`.

### Métodos de pago guardados (tokenización)

**`/api/payments/metodos-pago`** (JWT): listar, obtener, crear, patch, delete. Ver `CreateMetodoPagoDto` / `UpdateMetodoPagoDto`.

### BIN / MSI (público)

- `GET /api/payments/bin-lookup?bin=...`
- `GET /api/payments/msi-indicio?bancoEmisor=...`

---

## 8. Operación

| Tema | Valor |
|------|--------|
| Prefijo global | `/api` (rutas `/` y `/salud` excluidas) |
| Auth e‑commerce | `Authorization: Bearer <jwt>` |
| Admin | Rol `admin` en JWT donde el controlador use `RolesGuard` |

**Errores (filtro global):** cuerpo JSON típico:

```json
{
  "success": false,
  "statusCode": 400,
  "timestamp": "...",
  "path": "/api/pedidos",
  "error": "...",
  "message": "...",
  "errors": { "campo.anidado": "mensaje" }
}
```

En **400** de validación, `errors` es un objeto campo → primer mensaje (ver `ValidationPipe` + `flattenValidationErrors` en `main.ts`).

---

## 9. Ejemplos `curl` (flujo mínimo)

Sustituir `TOKEN` y IDs.

```bash
# Carrito
curl -s -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"productoId":1,"presentacionId":17,"cantidad":2}' \
  POST http://localhost:3001/api/carrito

# Pedido
curl -s -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productoId":1,"presentacionId":17,"cantidad":2}],"direccionEnvioId":null,"estado":"pendiente_pago"}' \
  POST http://localhost:3001/api/pedidos

# Pagos del pedido 42
curl -s -H "Authorization: Bearer TOKEN" \
  GET http://localhost:3001/api/pagos/pedido/42
```

---

## 10. Próximo paso recomendado (OpenAPI)

Para “100% sin adivinar”, añadir `@nestjs/swagger`, decorar DTOs y exponer `GET /api/docs` o exportar JSON. Este markdown puede migrarse a descripciones `description` en OpenAPI.

---

## 11. Contrato cerrado para `/admin/venta-online`

Sección pensada para implementar panel admin operativo con el backend actual.

### 11.1 Listado de pedidos para admin

- **Endpoint oficial:** `GET /api/pedidos` (JWT).
- **Comportamiento admin:** si el JWT tiene rol admin, devuelve pedidos globales; opcional `?usuarioId=<uuid>` para filtrar por cliente.
- **Filtros soportados hoy:**
  - `usuarioId`, `estado`, `fechaDesde`, `fechaHasta`, `metodoPago`, `q`.
- **Ordenamiento:** `sort=creadoEn:desc|creadoEn:asc` (default `creadoEn:desc`).
- **Paginación:** implementada con `page` y `limit` (máx `100`).
- **Shape de respuesta actual:** `{ success, count, page, limit, totalPages, data }`.

### 11.2 Acciones operativas por pedido

Todas estas acciones se hacen con `PUT /api/pedidos/:id` (JWT), body `UpdatePedidoDto`.

- **Preparar:** `{ "estado": "preparando" }` (solo admin).
- **Enviar:** `{ "estado": "enviado" }` (solo admin).
- **Entregado:** `{ "estado": "entregado" }` (solo admin).
- **Cancelar:** `{ "estado": "cancelado" }` (solo admin).
- **Ajustar costos:** `{ "costoEnvio": n, "impuestos": n, "descuento": n }` (solo admin).
- **Completar pago faltante en pedido:** `{ "metodoPago": "...", "referenciaPago": "..." }` (usuario dueño o admin).

**Campos permitidos por `UpdatePedidoDto`:**

- `estado` (enum `EstadoPedido`)
- `direccionEnvioId` (`uuid | null`)
- `direccionTextoCompleta` (`string | null`)
- `notasCliente` (`string | null`)
- `moneda` (`string`)
- `costoEnvio` (`number >= 0`)
- `impuestos` (`number >= 0`)
- `descuento` (`number >= 0`)
- `metodoPago` (`string | null`)
- `referenciaPago` (`string | null`)

**Reglas de permisos backend hoy:**

- No admin: el service elimina de `updateData` `estado`, `costoEnvio`, `impuestos`, `descuento`.
- Admin: puede actualizar todo lo anterior.

### 11.3 Envíos (botones Enviar / Rastrear)

CRUD completo disponible (JWT):

- `GET /api/envios/pedido/:pedidoId` (listar por pedido)
- `GET /api/envios/:id` (detalle)
- `POST /api/envios` (crear)
- `PUT /api/envios/:id` (editar)
- `DELETE /api/envios/:id` (eliminar)

**DTO create/update (`CreateEnvioDto`/`UpdateEnvioDto`):**

- `pedidoId` (solo create)
- `empresaEnvio?: string | null`
- `numeroGuia?: string | null`
- `estadoEnvio?: EstadoEnvio`
- `fechaEnvio?: string | null` (ISO datetime)
- `fechaEntrega?: string | null` (ISO datetime)
- `notas?: string | null`

**Estados válidos `EstadoEnvio`:** `preparando`, `en_transito`, `entregado`, `fallido`.

### 11.4 Pagos en admin

`PATCH /api/pagos/:id` acepta hoy (JWT, dueño/admin por `assertPedido`):

- `estado`
- `referenciaExterna`
- `errorMensaje`
- `pagadoEn`
- `payload`
- `monto`

**Importante de consistencia:** el backend **no sincroniza automáticamente** estado de pedido al cambiar pago.

Ejemplo: si pones pago `aprobado`, el pedido no cambia solo a `pagado`. Debe hacerse aparte con:

1. `PATCH /api/pagos/:id` (estado pago), y luego
2. `PUT /api/pedidos/:id` con `{ "estado": "pagado" }` (admin).

### 11.5 Crear pedido manual desde admin (“Nuevo pedido online”)

Soportado con `POST /api/pedidos` (JWT admin):

- Se puede enviar `usuarioId` para crear pedido a otro usuario.
- `items` obligatorio (mínimo 1).
- `direccionEnvioId` puede ir `null`/omitido.
- `estado`, `metodoPago`, `notasCliente` opcionales.

**Por línea (`items[]`) hoy se exige DTO con:**

- `productoId` (obligatorio por DTO)
- `presentacionId` (obligatorio)
- `cantidad` (obligatorio)

**Nota:** el backend usa el `productoId` real de la presentación en BD al guardar, pero el DTO sigue requiriendo enviar `productoId`.

**Convención sin dirección:** `direccionEnvioId: null` + detalle en `notasCliente` (ej. retiro en tienda).

### 11.6 Datos para selector de cliente y direcciones

**Clientes (admin):**

- Disponible hoy: `GET /api/usuarios` (JWT + rol admin), respuesta `{ success, count, data }`.
- Incluye `id`, `nombre`, `email`, `telefono`, etc.
- **Búsqueda server-side disponible** con `GET /api/usuarios?q=texto` (nombre/email/teléfono).

**Direcciones de un cliente (admin):**

- `GET /api/direcciones-usuario?usuarioId=<uuid>` (JWT, solo admin para `usuarioId` ajeno).

### 11.7 Reglas de estado recomendadas para UI (aunque backend no bloquee)

El backend no implementa máquina de estados estricta para pedido/pago/envío.
Para evitar incoherencias operativas, se recomienda esta política en frontend admin:

- **Pedido (`EstadoPedido`)**
  - `borrador` -> `pendiente_pago` -> `pagado` -> `preparando` -> `enviado` -> `entregado`
  - `cancelado` permitido desde estados previos a `entregado`.
- **Pago (`EstadoPago`)**
  - `pendiente` -> `aprobado` | `rechazado` | `cancelado`
  - `aprobado` -> `reembolsado` (si hay devolución).
- **Envío (`EstadoEnvio`)**
  - `preparando` -> `en_transito` -> `entregado`
  - `fallido` como estado terminal alterno.

Semáforo visual sugerido:

- `success`: `pagado`, `entregado`, `aprobado`.
- `warning`: `pendiente_pago`, `preparando`, `en_transito`, `pendiente`.
- `danger`: `cancelado`, `rechazado`, `fallido`, `reembolsado`.
- `muted/info`: `borrador`.

### 11.8 Auditoría y trazabilidad

Sí hay registro en `historial_estados_pedido` cuando:

- Se crea pedido (`origen: "api.crear_pedido"`).
- Admin cambia estado vía `PUT /api/pedidos/:id` (`origen: "api.actualizar_pedido_admin"`).

El `origen` se setea en backend; no se envía desde frontend en `UpdatePedidoDto`.

### 11.9 Errores y estabilidad de contrato

Formato de error global del filtro:

- Siempre incluye `success: false`, `statusCode`, `timestamp`, `path`, `error`, `message`.
- En validación, además puede incluir `errors` (objeto campo -> mensaje).

Ejemplo esperado:

```json
{
  "success": false,
  "statusCode": 400,
  "error": "Errores de validación",
  "message": "Revisa los campos del formulario",
  "errors": {
    "items.0.presentacionId": "presentacionId must not be less than 1"
  }
}
```

Y sí: `forbidNonWhitelisted` sigue activo globalmente para estos endpoints.
