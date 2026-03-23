# Tablas e-commerce (pedidos, carrito, pagos, etc.)

Modelos añadidos en `prisma/schema.prisma`:

| Modelo Prisma | Tabla PostgreSQL |
|---------------|------------------|
| `DireccionUsuario` | `direcciones_usuario` |
| `Pedido` | `pedidos` |
| `PedidoItem` | `pedido_items` |
| `CarritoItem` | `carrito_items` |
| `Pago` | `pagos` |
| `HistorialEstadoPedido` | `historial_estados_pedido` |
| `Envio` | `envios` |
| `Factura` | `facturas` |
| `Valoracion` | `valoraciones` |
| `Devolucion` | `devoluciones` |
| `Notificacion` | `notificaciones` |

**Enums:** `TipoDomicilio`, `EstadoPedido`, `EstadoEnvio`, `EstadoPago`.

## Base de datos (Neon)

Ejecutar el script (una vez):

`prisma/migrations/create_ecommerce_pedidos_y_relacionadas.sql`

Luego:

```bash
npx prisma generate
```

**API REST:** módulo Nest `EcommerceModule` — ver **`ECOMMERCE_API.md`** (11 recursos, JWT, validaciones DTO).
