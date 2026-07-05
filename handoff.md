# Handoff — Módulos de Operaciones (Backend NestJS)

**Fecha**: 2026-06-13 / 2026-06-14  
**Repo**: `c:\Users\Miguel Angel\backend-miru`  
**Estado**: ✅ 5 módulos completados, build limpio, migraciones aplicadas en Neon

---

## Resumen ejecutivo

Se construyeron 5 módulos nuevos **sin modificar ningún código existente** (solo adiciones).  
Todos pasan `npm run build` (tsc sin errores) y sus migraciones están aplicadas en producción.

---

## Módulos entregados

### Módulo 1 — Inventario

**Archivos:**
- `src/inventario/inventario.service.ts` — 8 métodos públicos
- `src/inventario/inventario.module.ts` — agregado `exports: [InventarioService]`
- `src/inventario/dto/` — `list-movimientos.dto.ts`, `alertas-stock.dto.ts`, `caducidades.dto.ts`, `conteo-fisico.dto.ts`, `create-ajuste.dto.ts`, `create-entrada.dto.ts`, `create-salida.dto.ts`
- `src/inventario/inventario.controller.ts`

**Endpoints** (`/api/inventario`):
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/movimientos` | Listado paginado con kardex raw SQL |
| GET | `/alertas-stock` | Presentaciones bajo stock mínimo |
| GET | `/caducidades` | Productos próximos a vencer |
| GET | `/kardex/:presentacionId` | Historial completo de una presentación |
| POST | `/entrada` | Registrar entrada de stock |
| POST | `/salida` | Registrar salida de stock |
| POST | `/ajuste` | Ajuste de inventario (conteo físico) |
| POST | `/conteo-fisico` | Conteo físico masivo |

**DTOs `create-entrada`, `create-salida`, `create-ajuste`** tienen campos opcionales `referenciaTipo?: string` y `referenciaId?: string` para vincular movimientos a otras entidades (citas, ventas).

---

### Módulo 2 — Empleados + PermisoRol + PermisosGuard

**Archivos nuevos:**
- `src/empleados/` — controller, service, module, DTOs
- `src/permisos/` — controller, service, module, DTOs
- `src/common/guards/permisos.guard.ts` — `PermisosGuard` + decorador `@Permisos(...)`
- `prisma/seed.ts` — siembra permisos iniciales por rol

**PermisosGuard:**
- Consulta `PermisoRol` en BD por el rol del JWT
- `'*'` en claves = admin pass-all
- Setea `request.permisosUsuario` y `request.rolUsuario` para scope downstream
- **No** modifica ni reemplaza `RolesGuard` — son independientes

**Roles válidos en BD** (strings exactos): `'admin'`, `'estilista'`, `'empleado'`, `'becario'`, `'cliente'`

**Permisos sembrados por defecto:**
```
admin     → ['*']
estilista → ['citas:propias', 'servicios:lectura', 'clientes:lectura']
empleado  → ['ventas:escritura', 'citas:escritura', 'inventario:lectura']
becario   → ['citas:asignadas', 'servicios:lectura', 'clientes:lectura']
cliente   → ['tienda:propia', 'citas:propia', 'perfil:propio']
```

---

### Módulo 3 — Clientes + Quejas + Seguimientos

**Archivos:**
- `src/clientes/` — controller, service, module, DTOs
- `src/quejas/` — controller, service, module, DTOs
- `src/seguimientos/` — controller, service, module, DTOs

**Endpoints Clientes** (`/api/clientes`): listar, obtener, historial-compras, historial-citas  
**Endpoints Quejas** (`/api/quejas`): CRUD + cambio de estado  
**Endpoints Seguimientos** (`/api/seguimientos`): CRUD con filtro por cliente

**Regla de scope:** un `cliente` solo ve sus propios registros; staff ve todo.

---

### Módulo 4 — Citas / Agenda

**Archivos:**
- `src/citas/dto/` — 6 DTOs: `list-citas`, `create-cita`, `update-cita`, `reprogramar-cita`, `cancelar-cita`, `materiales-cita`
- `src/citas/citas.service.ts`
- `src/citas/citas.controller.ts`
- `src/citas/citas.module.ts` — importa `PrismaModule` + `InventarioModule`

**Endpoints** (`/api/citas`):
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Listado paginado con filtros |
| GET | `/dia?fecha=` | Citas de un día |
| GET | `/calendario?desde=&hasta=` | Rango para vista calendario |
| GET | `/:id` | Detalle |
| POST | `/` | Crear (valida solapamiento + rol especialista) |
| PATCH | `/:id` | Editar (admin only) |
| PATCH | `/:id/check-in` | Estado → `en_curso` |
| PATCH | `/:id/check-out` | Estado → `completada` |
| PATCH | `/:id/reprogramar` | Nuevo horario, excluye solapamiento propio |
| PATCH | `/:id/cancelar` | Estado → `cancelada` + motivoCancelacion |
| POST | `/:id/materiales` | Registra salidas de inventario vinculadas |

**Reglas de negocio:**
- Especialistas válidos: `estilista`, `empleado`, `becario` (nunca `cliente` ni `admin`)
- Scope por `request.rolUsuario`: admin→todo, especialista→`especialistaId===userId`, cliente→`clienteId===userId`
- Materiales: llama `inventarioService.registrarSalida({ referenciaTipo: 'cita', referenciaId: cita.id.toString() })`

**Pendiente resuelto aquí:** `clientes.service.ts#historialCitas` completado con query real a `Cita`.

---

### Módulo 5 — POS / Ventas Local

**Archivos:**
- `src/pos/dto/` — 5 DTOs: `list-ventas`, `create-venta`, `cancelar-venta`, `create-corte`, `list-cortes`
- `src/pos/pos.service.ts`
- `src/pos/pos.controller.ts`
- `src/pos/pos.module.ts` — importa `PrismaModule` + `InventarioModule`

**Endpoints** (`/api/pos`):
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ventas` | Listado paginado |
| GET | `/ventas/:id` | Detalle con items |
| POST | `/ventas` | Crear venta → estado `pagada` + descuenta inventario |
| PATCH | `/ventas/:id/cancelar` | Cancelar + revierte inventario |
| GET | `/resumen` | Totales por periodo y método de pago |
| GET | `/cortes` | Listado cortes de caja |
| GET | `/cortes/:id` | Detalle con ventas vinculadas |
| POST | `/cortes` | Crear corte + auto-vincular ventas del turno |

**Reglas de negocio:**
- Permiso requerido: `ventas:escritura` (admin, estilista, empleado — NO becario ni cliente)
- Folio auto-generado: `VL-{año}-{id:06}` (ej. `VL-2026-000001`)
- `precioUnitario` en cada item es opcional; si se omite, se toma de `ProductoPresentacion.precio`
- `descuento` es monto fijo en MXN, no porcentaje
- Al cancelar: `registrarEntrada({ referenciaTipo: 'venta_local', referenciaId: ventaId.toString() })` por cada item
- Corte de caja: calcula automáticamente `totalVentas`, `totalEfectivo`, `totalTarjeta`, `totalTransferencia`, `diferencia` del turno del cajero en la fecha indicada

---

## Cambios en `prisma/schema.prisma`

Todos aditivos — ningún campo existente fue renombrado ni eliminado.

### Nuevos modelos (en orden al final del archivo)

| Modelo | Tabla | Módulo |
|--------|-------|--------|
| `PerfilEmpleado` | `perfiles_empleado` | 2 |
| `PermisoRol` | `permisos_rol` | 2 |
| `Queja` | `quejas` | 3 |
| `SeguimientoPostServicio` | `seguimientos_post_servicio` | 3 |
| `Cita` | `citas` | 4 |
| `VentaLocal` | `ventas_local` | 5 |
| `VentaLocalItem` | `ventas_local_items` | 5 |
| `CorteCaja` | `cortes_caja` | 5 |

### Nuevos enums

`EstadoQueja`, `EstadoCita`, `EstadoVentaLocal`, `MetodoPagoLocal`

### Campos añadidos a modelos existentes

**`Usuario`** (solo campos de relación inversa, sin columnas nuevas en BD):
```prisma
perfilEmpleado             PerfilEmpleado?
quejas                     Queja[]
seguimientos               SeguimientoPostServicio[]
citasComoCliente           Cita[]  @relation("CitasComoCliente")
citasComoEspecialista      Cita[]  @relation("CitasComoEspecialista")
ventasComoCajero           VentaLocal[] @relation("VentasComoCajero")
ventasComoCliente          VentaLocal[] @relation("VentasComoCliente")
cortesCaja                 CorteCaja[]  @relation("CortesComoCajero")
```

**`Servicio`**: `citas Cita[]`  
**`ProductoPresentacion`**: `ventasLocalItems VentaLocalItem[]`

---

## Migraciones aplicadas

| Archivo | Contenido |
|---------|-----------|
| `prisma/migrations/20260613000100_add_perfil_empleado_permiso_rol/` | Tablas `perfiles_empleado` + `permisos_rol` |
| `prisma/migrations/20260613000200_add_queja_seguimiento/` | Tablas `quejas` + `seguimientos_post_servicio` (sin FK a citas aún) |
| `prisma/migrations/20260613000300_add_cita_model/` | Enum `EstadoCita` + tabla `citas` + FK real en `seguimientos_post_servicio.cita_id` |
| `prisma/migrations/20260613000400_add_pos_ventas_local/` | Enums `EstadoVentaLocal`/`MetodoPagoLocal` + tablas `ventas_local`, `ventas_local_items`, `cortes_caja` |

Todas aplicadas con `npx prisma migrate deploy` (no-interactivo, compatible con CI/Neon).

---

## Patrones a respetar en futuros módulos

```typescript
// Guard pattern
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos('clave:permiso')

// Service constructor
constructor(private readonly prisma: PrismaService) {}

// Service constructor con inventario
constructor(
  private readonly prisma: PrismaService,
  private readonly inventarioService: InventarioService,
) {}

// Respuesta paginada estándar
return { success: true, count: total, page, limit, totalPages, data };

// Respuesta simple
return { success: true, data };
```

- **Nunca** usar `fetch` directo — todo pasa por `apiClient` en el frontend
- **Siempre** `sanitizeInput` + `containsSQLInjection` en campos de texto libre
- **Siempre** `$transaction` para escrituras que tocan múltiples tablas
- Migraciones: crear SQL manual en `prisma/migrations/YYYYMMDDHHMMSS_nombre/migration.sql` y aplicar con `migrate deploy`
- `db push` está **prohibido** — puede eliminar la tabla `demo_truncate` que existe en BD pero no en schema

---

## Qué falta

### Frontend (próxima sesión)

Crear/actualizar páginas y servicios en `miru-franco-web` para consumir los nuevos endpoints:

| Módulo | Páginas frontend estimadas |
|--------|---------------------------|
| Inventario | `/admin/inventario` — movimientos, alertas, kardex, conteo físico |
| Empleados | `/admin/empleados` — CRUD + perfil |
| Permisos | `/admin/permisos` — gestión de claves por rol |
| Clientes (admin) | `/admin/clientes` — listado + historial |
| Quejas | `/admin/quejas` — gestión de estado |
| Seguimientos | `/admin/seguimientos` |
| Citas | `/admin/citas` — calendario, check-in/out |
| POS | `/operacion/pos` — TPV, corte de caja |

Todos los servicios frontend deben usar `apiClient` de `services/client.ts` con `getBackendBaseUrl()` como tercer argumento.
