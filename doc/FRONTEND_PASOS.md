# Qué hacer en el frontend (Miru Franco)

Checklist para conectar tu frontend con Cloudinary y la API de productos del backend.

---

## 1. Variables de entorno (frontend)

En la raíz de tu **proyecto frontend**, crea o edita `.env` (o `.env.local`):

```env
# API del backend
VITE_API_URL=http://localhost:3001/api

# Cloudinary - Upload Preset (la carpeta se configura en el preset, no aquí)
VITE_CLOUDINARY_CLOUD_NAME=tu_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET_PRODUCTOS=ml_productos
VITE_CLOUDINARY_UPLOAD_PRESET_SERVICIOS=ml_servicios
```

- Si solo tienes productos, basta un preset: `VITE_CLOUDINARY_UPLOAD_PRESET=ml_productos` (y en el código usa ese env como preset por defecto).
- Si usas **Next.js**: cambia `VITE_` por `NEXT_PUBLIC_`.
- `VITE_API_URL`: URL base del backend (ej. `http://localhost:3001/api`).

---

## 2. Configurar Upload Presets en Cloudinary

La **carpeta** y otras opciones se configuran en Cloudinary, no en el código.

1. Entra a [Cloudinary Console](https://console.cloudinary.com) → **Settings** (engranaje) → **Upload** → **Upload presets**.
2. **Add upload preset** (o edita uno existente).
3. Configura:
   - **Preset name**: ej. `ml_productos` (este nombre va en tu `.env`).
   - **Signing Mode**: **Unsigned** (para subir desde el navegador).
   - **Folder**: ej. `miru/productos` (todas las imágenes de este preset irán aquí).
4. Guarda.

Para **servicios**, crea **otro** preset (ej. nombre `ml_servicios`, folder `miru/servicios`). En el frontend usarás un preset u otro según el tipo de contenido.

---

## 3. Función para subir imágenes (solo preset, sin enviar folder)

Crea un archivo de utilidad, por ejemplo `src/utils/cloudinary.js` (o `.ts`):

```javascript
const getCloudinaryUrl = () =>
  `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`;

/**
 * Sube un archivo a Cloudinary usando el Upload Preset.
 * La carpeta (miru/productos, miru/servicios, etc.) está definida en el preset en Cloudinary.
 * @param {File} file - Archivo de imagen
 * @param {string} preset - Nombre del preset: 'ml_productos', 'ml_servicios', etc.
 * @returns {Promise<string>} URL de la imagen
 */
// Preset por defecto: productos (o el único que tengas: VITE_CLOUDINARY_UPLOAD_PRESET)
const presetProductos = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET_PRODUCTOS || import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export async function subirImagenCloudinary(file, preset = presetProductos) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', preset);

  const res = await fetch(getCloudinaryUrl(), {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Error al subir la imagen');
  }

  const data = await res.json();
  return data.secure_url;
}

/**
 * Sube varias imágenes con el mismo preset.
 */
export async function subirImagenesCloudinary(files, preset = presetProductos) {
  const urls = await Promise.all(
    Array.from(files).map((file) => subirImagenCloudinary(file, preset))
  );
  return urls;
}
```

**Uso:**

- Productos: `subirImagenCloudinary(file)` o `subirImagenCloudinary(file, import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET_PRODUCTOS)`.
- Servicios: `subirImagenCloudinary(file, import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET_SERVICIOS)`.

---

## 4. Listar productos (catálogo)

- **GET** `{VITE_API_URL}/productos`  
  Ejemplo: `fetch(`${import.meta.env.VITE_API_URL}/productos`)`
- Respuesta: `{ success: true, count: N, data: [ { id, nombre, marca, presentaciones: [{ tamanio, precio, imagenes: [...] }], ... } ] }`
- Muestra imágenes por presentación, ej. `<img src={producto.presentaciones[0]?.imagenes?.[0]} />`.

---

## 5. Detalle de un producto

- **GET** `{VITE_API_URL}/productos/:id`  
  Ejemplo: `fetch(`${import.meta.env.VITE_API_URL}/productos/1`)`
- Respuesta: `{ success: true, data: { id, nombre, presentaciones, ... } }`
- Usa `data.presentaciones[i].imagenes` para galería/imagen principal por presentación.

---

## 6. Crear o editar producto (formulario)

Flujo recomendado:

1. El usuario elige una o varias imágenes (input type file o drag & drop).
2. **Antes** de enviar el formulario al backend, sube cada imagen con `subirImagenCloudinary(file)` o `subirImagenesCloudinary(files)` (usan el preset de productos; la carpeta ya está en el preset).
3. Obtén el array de URLs devueltas.
4. Envía al backend el objeto del producto con imágenes dentro de cada presentación: `presentaciones[].imagenes`.

Ejemplo de payload al crear producto:

```javascript
const payload = {
  nombre: 'Shampoo Reparador',
  marca: 'Marca',
  descripcion: 'Descripción corta',
  descripcionLarga: 'Descripción larga...',
  precio: '$250',
  precioOriginal: '$300',
  descuento: 17,
  categoria: 'shampoo',
  stock: 10,
  disponible: true,
  nuevo: true,
  crueltyFree: true,
  caracteristicas: ['Sin sulfatos', 'Vegano'],
  ingredientes: 'Aqua, ...',
  // Una entrada por presentación (250ml, 500ml, 1000ml, etc.). Pueden ser 2, 3 o más.
  presentaciones: [
    { tamanio: '250ml', imagenes: urls250, precio: '$150', precioOriginal: '$180', stock: 5, disponible: true },
    { tamanio: '500ml', imagenes: urls500, precio: '$250', precioOriginal: '$300', stock: 10, disponible: true },
    { tamanio: '1000ml', imagenes: urls1000, precio: '$450', precioOriginal: '$500', stock: 8, disponible: true },
  ],
};

// Crear
await fetch(`${import.meta.env.VITE_API_URL}/productos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});

// Actualizar
await fetch(`${import.meta.env.VITE_API_URL}/productos/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
```

- **POST** y **PUT** productos requieren **JWT** (header `Authorization: Bearer <token>`) y rol **admin**.

---

## 7. Resumen de pasos en el frontend

| Paso | Acción |
|------|--------|
| 1 | En Cloudinary: crear Upload Preset(s) **Unsigned** y en cada uno definir la **Folder** (ej. `miru/productos`, `miru/servicios`). |
| 2 | En `.env` del frontend: `VITE_API_URL`, `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET_PRODUCTOS` (y opcionalmente `VITE_CLOUDINARY_UPLOAD_PRESET_SERVICIOS`). |
| 3 | Crear `subirImagenCloudinary` / `subirImagenesCloudinary` que solo envíen `file` y `upload_preset` (sin `folder`). |
| 4 | En el formulario de producto: subir imágenes con el preset de productos y guardar las URLs. |
| 5 | Al enviar el formulario, incluir `presentaciones[].imagenes: [url1, url2, ...]` en POST/PUT a `/productos`. |
| 6 | En listado y detalle: usar `producto.presentaciones[i].imagenes` para mostrar fotos. |

Para **servicios**, usa el preset de servicios: `subirImagenCloudinary(file, import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET_SERVICIOS)` y guarda las URLs en tu modelo de servicios.
