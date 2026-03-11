# Cómo usar Cloudinary con Miru Franco

Las imágenes se suben a **Cloudinary** y en la base de datos solo guardas las **URLs** en el campo `imagenes` del producto.

---

## Dónde poner las variables

### Opción recomendada: subir desde el **frontend**

Si el usuario sube la foto en tu app (formulario de producto), lo más simple es subir **directo desde el frontend** a Cloudinary. Así el backend no toca Cloudinary.

- **Variables**: van en el **`.env` del frontend** (proyecto React/Vite/Next, etc.).
- **Backend**: no necesita variables de Cloudinary; solo recibe las URLs y las guarda en `imagenes`.

### Opción alternativa: subir desde el **backend**

Si quieres que el frontend envíe el archivo al backend y el backend lo suba a Cloudinary:

- **Variables**: van en el **`.env` del backend** (este proyecto).
- **Backend**: necesitas un endpoint que reciba el archivo, llame a la API de Cloudinary y devuelva la URL.

---

## Variables de Cloudinary

Solo necesitas **3 valores** del dashboard de Cloudinary:

| Variable | Descripción | Dónde se ve en Cloudinary |
|----------|-------------|----------------------------|
| `CLOUDINARY_CLOUD_NAME` | Nombre de tu cloud | Dashboard → inicio (ej. `dxxxxxx`) |
| `CLOUDINARY_API_KEY` | API Key | Dashboard → API Keys |
| `CLOUDINARY_API_SECRET` | API Secret | Dashboard → API Keys (oculto, “reveal”) |

---

## 1. Subir desde el **frontend** (recomendado)

### Dónde poner las variables

En el **proyecto del frontend**, crea o edita `.env` (o `.env.local`):

```env
# Cloudinary - subida desde el navegador
VITE_CLOUDINARY_CLOUD_NAME=tu_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=tu_upload_preset
```

- En **Create React App** o **Vite**: usa el prefijo `VITE_` para que se lean en el cliente (ej. `VITE_CLOUDINARY_CLOUD_NAME`).
- En **Next.js**: usa `NEXT_PUBLIC_` (ej. `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET`).

**No pongas** `API_SECRET` en el frontend (es secreto). Por eso se usa un **Upload Preset** sin firmar.

### Crear el Upload Preset en Cloudinary

1. Entra a [Cloudinary Console](https://console.cloudinary.com).
2. **Settings** (engranaje) → **Upload** → **Upload presets**.
3. **Add upload preset**.
4. **Signing Mode**: **Unsigned** (para subir desde el navegador sin API Secret).
5. Guarda y copia el **Preset name** (ej. `ml_default`). Ese valor es tu `CLOUDINARY_UPLOUD_PRESET`.

### Ejemplo de subida en el frontend (JavaScript)

```javascript
// URL de la API de subida de Cloudinary (pública con unsigned preset)
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`;

async function subirImagen(archivo) {
  const formData = new FormData();
  formData.append('file', archivo);
  formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(CLOUDINARY_URL, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw new Error('Error al subir');
  const data = await res.json();
  return data.secure_url;  // URL para guardar en tu BD
}

// Uso: al crear/editar producto, subes cada imagen y guardas las URLs en "imagenes"
// const url1 = await subirImagen(archivo1);
// const url2 = await subirImagen(archivo2);
// imagenes: [url1, url2]
```

Luego envías al backend el producto con `imagenes: [url1, url2, ...]` y el backend ya las guarda en la base de datos.

---

## 2. Subir desde el **backend**

Solo si quieres que el backend reciba el archivo y lo suba a Cloudinary.

### Dónde poner las variables

En el **`.env` del backend** (este repo):

```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
```

### Cómo obtener los valores

1. [Cloudinary Console](https://console.cloudinary.com) → Dashboard.
2. Ahí ves **Cloud name**, **API Key**.
3. **API Secret**: en **API Keys** → “Reveal” para copiarlo.

### Uso en el backend

Necesitarías instalar el SDK y crear un endpoint (por ejemplo `POST /api/productos/upload-image`) que reciba el archivo, llame a Cloudinary y devuelva la URL. Si más adelante quieres que te escribamos ese endpoint, lo hacemos en otro paso.

---

## Resumen

| Qué quieres | Dónde van las variables | Qué necesitas |
|------------|--------------------------|---------------|
| Subir desde el **frontend** | `.env` del **frontend** | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` (unsigned) |
| Subir desde el **backend** | `.env` del **backend** | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |

En ambos casos, en la base de datos solo guardas las **URLs** en el array `imagenes` del producto; las imágenes físicas están en Cloudinary.
