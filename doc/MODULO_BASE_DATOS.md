# Módulo de Base de Datos (db)

Módulo que permite a administradores **importar**, **exportar** y **visualizar el diagrama ER** de la base de datos. Todas las rutas requieren autenticación JWT y rol `admin`.

---

## Rutas API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/db/diagram?formato=mermaid\|svg\|png` | Descarga el diagrama ER del schema Prisma |
| `GET` | `/api/db/import/tables` | Lista tablas importables y modos disponibles |
| `POST` | `/api/db/import` | Importa datos desde archivo CSV o JSON |
| `GET` | `/api/db/export?tabla=&formato=csv\|json` | Exporta datos de una tabla a CSV o JSON |

---

## 1. Diagrama ER (`GET /api/db/diagram`)

Genera un diagrama entidad-relación a partir de `prisma/schema.prisma`.

### Parámetros (query)

| Parámetro | Tipo | Requerido | Valores | Descripción |
|-----------|------|-----------|---------|-------------|
| `formato` | string | No | `mermaid`, `svg`, `png` | Por defecto: `mermaid` |

### Formatos

- **mermaid** (`.mmd`): Código Mermaid para usar en GitHub, Notion, editores compatibles
- **svg**: Imagen vectorial SVG
- **png**: Imagen raster PNG

### Ejemplo

```
GET /api/db/diagram?formato=mermaid
Authorization: Bearer <token-admin>
```

---

## 2. Importación (`POST /api/db/import`)

Importa registros desde un archivo CSV o JSON a una tabla permitida.

### Content-Type

`multipart/form-data`

### Campos del formulario

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tabla` | string | Sí | `productos`, `usuarios`, `servicios` o `direcciones_usuario` |
| `archivo` | File | Sí | Archivo CSV o JSON (máx. 5 MB) |
| `formato` | string | No | `csv` o `json` (se infiere por extensión si se omite) |
| `modo` | string | No | `append` (default), `missing_only`, `upsert` |

### Modos de importación

- `append`: inserta con comportamiento actual (compatibilidad retroactiva).
- `missing_only`: inserta solo faltantes por clave de conflicto.
- `upsert`: inserta si no existe y actualiza si ya existe.

> Nota: `missing_only` y `upsert` están soportados hoy para `servicios`.  
> En `usuarios` se mantiene solo `append` por seguridad (hash de password).  
> En `missing_only`/`upsert`, si falta clave de conflicto (ej. `id`) se responde 400.

### Tablas permitidas

| Tabla | Import | Modos |
|-------|--------|-------|
| `productos` | Sí | `append` |
| `usuarios` | Sí | `append` |
| `servicios` | Sí | `append`, `missing_only`, `upsert` |
| `direcciones_usuario` | Sí | `append`, `missing_only`, `upsert` |

### Respuesta de éxito

```json
{
  "success": true,
  "modo": "missing_only",
  "tabla": "servicios",
  "totalFilasArchivo": 100,
  "importados": 10,
  "insertados": 10,
  "actualizados": 0,
  "omitidos": 90,
  "fallidos": 2,
  "errores": [
    { "fila": 3, "mensaje": "El campo 'precio' debe ser un número" },
    { "fila": 7, "mensaje": "El email ya está registrado" }
  ]
}
```

### Ejemplos request

```bash
# CSV - solo faltantes
curl -X POST "http://localhost:3001/api/db/import" \
  -H "Authorization: Bearer <token-admin>" \
  -F "tabla=servicios" \
  -F "modo=missing_only" \
  -F "archivo=@servicios_backup.csv"

# JSON - upsert
curl -X POST "http://localhost:3001/api/db/import" \
  -H "Authorization: Bearer <token-admin>" \
  -F "tabla=servicios" \
  -F "formato=json" \
  -F "modo=upsert" \
  -F "archivo=@servicios_backup.json"
```

### Errores posibles

| Código | Descripción |
|--------|-------------|
| 400 | Tabla no válida, archivo vacío, formato incorrecto |
| 401 | No autenticado |
| 403 | No es admin |
| 413 | Archivo mayor a 5 MB |

---

## 3. Exportación (`GET /api/db/export`)

Exporta los datos de una tabla en formato CSV o JSON para descargar.

### Parámetros (query)

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `tabla` | string | Sí | `productos`, `usuarios`, `servicios` o `direcciones_usuario` |
| `formato` | string | Sí | `csv` o `json` |

### Ejemplo

```
GET /api/db/export?tabla=productos&formato=csv
Authorization: Bearer <token-admin>
```

### Respuesta

- **Content-Type**: `application/json` o `text/csv`
- **Content-Disposition**: `attachment; filename="productos_2025-01-29.csv"`
- **Body**: archivo descargable

### Datos sensibles

- En **usuarios** no se exporta `password` ni campos internos (OTP, tokens, etc.)
- En **productos** y **servicios** se incluyen relaciones (presentaciones, especialistas) según corresponda

---

## Estructura de archivos

```
src/db/
├── db.constants.ts    # Tablas permitidas, límite de tamaño
├── db.controller.ts   # Rutas GET diagram, POST import, GET export
├── db.service.ts      # Lógica de import, export, diagrama
├── db.module.ts       # Módulo NestJS
└── schema-to-mermaid.ts  # Parser de schema.prisma → Mermaid erDiagram
```

---

## Dependencias

```json
{
  "mermaid": "^11.0.0",
  "sharp": "^0.33.0"
}
```

- **mermaid**: Genera SVG a partir del código Mermaid
- **sharp**: Convierte SVG a PNG

Para formato `mermaid` no se requieren dependencias adicionales; para `svg` y `png` sí.

---

## Seguridad

| Aspecto | Implementación |
|---------|----------------|
| Autorización | Solo rol `admin` (JwtAuthGuard + RolesGuard) |
| Tamaño de archivo | Límite 5 MB para importación |
| SQL injection | SQL dinámico restringido a allowlist de tabla/columnas validadas |
| Validación | Tipos, campos requeridos, formatos validados por registro |
| Datos sensibles | No exportar passwords, tokens, OTP |

---

## Formato CSV/JSON para importación

### Productos

Columnas esperadas (camelCase o snake_case): `nombre`, `marca`, `descripcion`, `categoria`, `imagenes` (separadas por `|` o `,`), `descuento`, `nuevo`, `crueltyFree`, `caracteristicas`, `ingredientes`, `modoUso`, `resultado`.

### Usuarios

Columnas: `nombre`, `email`, `password` (opcional, mínimo 8 caracteres; se hashea), `telefono`, `rol`, `confirmado`, `activo`, `aceptaAvisoPrivacidad`, `recibePromociones`, dirección y perfil capilar.

### Servicios

Columnas: `nombre`, `descripcion`, `precio`, `duracionMinutos`, `categoria`, `requiereEvaluacion`, `activo`, `imagen`, `incluye`, `recomendaciones` (arrays como JSON o separados).
