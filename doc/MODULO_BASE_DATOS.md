# Módulo de Base de Datos (db)

Módulo que permite a administradores **importar**, **exportar** y **visualizar el diagrama ER** de la base de datos. Todas las rutas requieren autenticación JWT y rol `admin`.

---

## Rutas API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/db/diagram?formato=mermaid\|svg\|png` | Descarga el diagrama ER del schema Prisma |
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
| `tabla` | string | Sí | `productos`, `usuarios` o `servicios` |
| `archivo` | File | Sí | Archivo CSV o JSON (máx. 5 MB) |
| `formato` | string | No | `csv` o `json` (se infiere por extensión si se omite) |

### Tablas permitidas

| Tabla | Import | Notas |
|-------|--------|-------|
| `productos` | Sí | Campos: nombre, marca, descripcion, categoria, imagenes, etc. |
| `usuarios` | Sí | `password` se hashea con bcrypt. No importar tokens ni OTP. |
| `servicios` | Sí | Campos: nombre, precio, categoria, duracionMinutos, etc. |

### Respuesta de éxito

```json
{
  "success": true,
  "importados": 15,
  "fallidos": 2,
  "errores": [
    { "fila": 3, "mensaje": "El campo 'precio' debe ser un número" },
    { "fila": 7, "mensaje": "El email ya está registrado" }
  ]
}
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
| `tabla` | string | Sí | `productos`, `usuarios` o `servicios` |
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
| SQL injection | Solo Prisma, sin SQL crudo |
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
