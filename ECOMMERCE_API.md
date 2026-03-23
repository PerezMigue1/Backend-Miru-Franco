# API e-commerce (`/api/...`)

Todas las rutas (excepto `GET /api/valoraciones/producto/:productoId`) requieren **Bearer JWT**.

Prefijo global: **`/api`**.

## Permisos

- **Cliente:** recursos propios (pedidos, direcciones, carrito, notificaciones del usuario, etc.).
- **Admin (`rol: admin`):** puede listar con `?usuarioId=`, crear pedidos para otro usuario (`usuarioId` en body), eliminar pedidos, crear notificaciones para cualquier usuario, etc.

---

## 1. Direcciones (`direcciones_usuario`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/direcciones-usuario` | Lista direcciones (admin: `?usuarioId=`). |
| GET | `/direcciones-usuario/:id` | Detalle. |
| POST | `/direcciones-usuario` | Crear (para el usuario autenticado). |
| PUT | `/direcciones-usuario/:id` | Actualizar. |
| DELETE | `/direcciones-usuario/:id` | Eliminar. |

**DTO:** `CreateDireccionUsuarioDto` / `UpdateDireccionUsuarioDto` — validación con `class-validator` (`TipoDomicilio`, longitudes, etc.).

---

## 2. Pedidos (`pedidos`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/pedidos` | Lista (propios; admin: `?usuarioId=`). |
| GET | `/pedidos/:id` | Detalle con ítems y dirección. |
| POST | `/pedidos` | Crea pedido con líneas; calcula subtotal/total desde presentaciones. |
| PUT | `/pedidos/:id` | Actualizar (cliente: notas/dirección; admin: también estado, envío, impuestos…). |
| DELETE | `/pedidos/:id` | **Solo admin.** |

**Body crear:** `items[]` con `productoId`, `presentacionId`, `cantidad` (mínimo 1 línea). Opcional: `direccionEnvioId`, `usuarioId` (solo admin), `estado`, `notasCliente`, etc.

---

## 3. Ítems de pedido (`pedido_items`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/pedidos/:pedidoId/items` | Lista líneas. |
| POST | `/pedidos/:pedidoId/items` | Añade línea; recalcula totales del pedido. |
| PUT | `/pedidos/:pedidoId/items/:itemId` | Actualizar cantidad / nombre / tamaño. |
| DELETE | `/pedidos/:pedidoId/items/:itemId` | Eliminar línea; recalcula totales. |

---

## 4. Carrito (`carrito_items`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/carrito` | Ítems activos (admin: `?usuarioId=`). |
| GET | `/carrito/:id` | Detalle de un ítem. |
| POST | `/carrito` | Upsert por `usuarioId` + `presentacionId`. |
| PUT | `/carrito/:id` | Actualizar cantidad / `activo` / `precioReferencia`. |
| DELETE | `/carrito/:id` | Quitar del carrito. |

---

## 5. Pagos (`pagos`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/pagos/pedido/:pedidoId` | Lista pagos del pedido. |
| GET | `/pagos/:id` | Detalle. |
| POST | `/pagos` | Registrar intento de pago. |
| PATCH | `/pagos/:id` | Actualizar estado, referencia externa, `pagadoEn`, etc. |

---

## 6. Historial de estado (`historial_estados_pedido`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/historial-estados-pedido/pedido/:pedidoId` | Historial cronológico. |
| GET | `/historial-estados-pedido/:id` | Un registro. |
| POST | `/historial-estados-pedido` | Añade entrada (`estadoNuevo`, `estadoAnterior` opcional, `origen`, `usuarioId` opcional). |

---

## 7. Envíos (`envios`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/envios/pedido/:pedidoId` | Lista envíos. |
| GET | `/envios/:id` | Detalle. |
| POST | `/envios` | Crear. |
| PUT | `/envios/:id` | Actualizar. |
| DELETE | `/envios/:id` | Eliminar. |

---

## 8. Facturas (`facturas`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/facturas/pedido/:pedidoId` | Lista. |
| GET | `/facturas/:id` | Detalle. |
| POST | `/facturas` | Crear. |
| PUT | `/facturas/:id` | Actualizar. |
| DELETE | `/facturas/:id` | Eliminar. |

---

## 9. Valoraciones (`valoraciones`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/valoraciones` | **JWT** — tus valoraciones; admin: todas o `?usuarioId=`. |
| GET | `/valoraciones/producto/:productoId` | **Público** — opiniones del producto. |
| GET | `/valoraciones/pedido/:pedidoId` | Con JWT — valoraciones del pedido. |
| GET | `/valoraciones/:id` | Detalle. |
| POST | `/valoraciones` | Crear (producto debe estar en el pedido; única por usuario+producto). |
| PUT | `/valoraciones/:id` | Autor o admin. |
| DELETE | `/valoraciones/:id` | Autor o admin. |

---

## 10. Devoluciones (`devoluciones`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/devoluciones/pedido/:pedidoId` | Lista. |
| GET | `/devoluciones/:id` | Detalle. |
| POST | `/devoluciones` | Crear (`estado`, `motivo`, `pedidoItemId`, `pagoId` opcionales; validados contra el pedido). |
| PUT | `/devoluciones/:id` | Actualizar. |
| DELETE | `/devoluciones/:id` | Eliminar. |

---

## 11. Notificaciones (`notificaciones`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/notificaciones` | Propias; admin: `?usuarioId=`; filtro `?leida=true|false`. |
| GET | `/notificaciones/:id` | Detalle (UUID). |
| POST | `/notificaciones` | **Solo admin** — crear para `usuarioId` del body. |
| PUT | `/notificaciones/:id` | Actualizar (p. ej. `leida`). |
| DELETE | `/notificaciones/:id` | Eliminar. |

---

## Validación

- **Pipe global** en `main.ts`: `ValidationPipe` con `whitelist`, `forbidNonWhitelisted`, `transform`.
- DTOs en `src/ecommerce/<recurso>/dto/*.dto.ts` (una carpeta por tabla) con `class-validator` / `class-transformer`.
- Servicio compartido de permisos: `src/ecommerce/common/ecommerce-access.service.ts`.
- Enums alineados con Prisma: `TipoDomicilio`, `EstadoPedido`, `EstadoEnvio`, `EstadoPago`.
