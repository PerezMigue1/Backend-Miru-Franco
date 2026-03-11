# 🛡️ Guía Frontend (React + Next.js): Subir la Nota a A/A+ en SecurityHeaders

## 📋 Contexto

Tu frontend está desplegado en **Vercel** con **Next.js**.  
SecurityHeaders está analizando la URL de tu frontend, por ejemplo:

`https://tu-proyecto.vercel.app/`

Vercel ya proporciona algunos encabezados de seguridad (como `Strict-Transport-Security` y `X-Frame-Options`), pero **no añade por defecto** todos los que SecurityHeaders espera para darte una nota **A/A+**.

Esta guía te explica cómo añadir los encabezados que faltan desde tu proyecto de **Next.js**.

---

## 🎯 Objetivo

SecurityHeaders te está marcando que faltan estos encabezados en tu **frontend** (Vercel):

- `Content-Security-Policy`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

Vercel ya incluye (normalmente):

- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options` (clickjacking)

Vamos a añadir los encabezados que faltan en tu proyecto de **Next.js** para mejorar la nota a **A / A+**.

---

## 1. Configurar encabezados en `next.config.js`

En la raíz de tu proyecto de frontend (Next.js), crea o edita el archivo `next.config.js` con algo como esto:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Aplica a todas las rutas
        source: '/(.*)',
        headers: [
          // 1) Evitar sniffing de tipos de contenido
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // 2) Política de referencia
          {
            key: 'Referrer-Policy',
            // Puedes usar 'no-referrer' si quieres ser más estricto
            value: 'strict-origin-when-cross-origin',
          },
          // 3) Política de permisos (limitar APIs del navegador)
          {
            key: 'Permissions-Policy',
            // Ajusta según lo que realmente uses
            value: 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
          },
          // 4) Content-Security-Policy (CSP)
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",                            // solo cargar recursos del mismo origen
              "script-src 'self' 'unsafe-inline'",             // scripts propios (añade CDNs si usas)
              "style-src 'self' 'unsafe-inline'",              // estilos propios + inline (Tailwind, etc.)
              "img-src 'self' data: https:",                   // imágenes locales + data URIs + https externos
              "font-src 'self' data:",                         // fuentes locales + data URIs
              "connect-src 'self' https://miru-franco.onrender.com https://*.vercel.app", // llamadas API
              "frame-ancestors 'none'",                        // nadie puede incluir tu sitio en un <iframe>
            ].join('; '),
          },
          // 5) (Opcional) Protección XSS heredada
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
```

> 🔎 **Importante:**
> - Ajusta `connect-src` según las APIs externas que uses (por ejemplo, otros dominios además de `https://miru-franco.onrender.com`).
> - Si usas scripts externos (CDNs, Google Analytics, etc.), tendrás que añadir sus dominios en `script-src`.
> - Si usas fuentes o imágenes de CDNs externos, también debes añadirlos en `font-src` y `img-src`.

---

## 2. Ajustar CSP si usas recursos externos

Algunos ejemplos de ajustes comunes:

### 2.1. Google Fonts

Si usas Google Fonts:

```js
"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
"font-src 'self' https://fonts.gstatic.com data:",
```

### 2.2. Imágenes desde un CDN

Si tienes un CDN, por ejemplo `https://cdn.tusitio.com`:

```js
"img-src 'self' data: https: https://cdn.tusitio.com",
```

### 2.3. Scripts de terceros (ej. Google Analytics)

```js
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
"connect-src 'self' https://miru-franco.onrender.com https://www.google-analytics.com https://*.vercel.app",
```

Solo añade dominios que realmente uses. Mientras más específica sea la CSP, mejor.

---

## 3. Hacer deploy en Vercel

1. Guarda los cambios en `next.config.js`.
2. Haz `git add` y `git commit` en tu proyecto de **frontend**.
3. Haz `git push` para que Vercel haga un nuevo deploy.
4. Verifica en el panel de Vercel que el deployment se completó correctamente.

---

## 4. Verificar los encabezados en el navegador

1. Abre tu frontend en producción, por ejemplo:  
   `https://tu-proyecto.vercel.app/`
2. Abre las **DevTools** (`F12`) y ve a la pestaña **Network**.
3. Recarga la página.
4. Haz clic en la primera petición (el documento HTML principal).
5. En **Response Headers**, verifica que aparezcan:
   - `Content-Security-Policy`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin` (o el valor que pusiste)
   - `Permissions-Policy: ...`
   - `X-XSS-Protection: 1; mode=block` (si lo agregaste)

Si ves esos headers, la configuración está activa.

---

## 5. Volver a probar en SecurityHeaders

1. Ve a `https://securityheaders.com/`.
2. Ingresa la URL de tu frontend, por ejemplo:  
   `https://tu-proyecto.vercel.app/`
3. Ejecuta el análisis.

Con los encabezados anteriores, deberías obtener una nota **A** o **A+**.

Si aún no llegas a A+:

- Cambia `Referrer-Policy` a un valor más estricto, por ejemplo `no-referrer`.
- Asegúrate de que no falte ningún encabezado clave que la herramienta marque como crítico.
- Revisa el detalle del reporte para ver qué header específico está pidiendo.

---

## 6. (Opcional) Caso especial: si no usas Next.js (solo React con `vercel.json`)

Si tu proyecto no usa Next.js y en su lugar es un React puro, puedes definir los headers en un archivo `vercel.json` en la raíz del proyecto:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=(), payment=(), usb=()" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://miru-franco.onrender.com https://*.vercel.app; frame-ancestors 'none'"
        },
        { "key": "X-XSS-Protection", "value": "1; mode=block" }
      ]
    }
  ]
}
```

Después de agregar este archivo, haz commit y push para que Vercel haga el deploy, y vuelve a probar en SecurityHeaders.

---

## 7. Checklist final para llegar a A/A+

- [ ] Frontend sirve por **HTTPS** (Vercel ya lo hace).
- [ ] `Strict-Transport-Security` presente (Vercel ya lo añade).
- [ ] `X-Frame-Options: DENY` presente (Vercel ya lo añade).
- [x] `X-Content-Type-Options: nosniff` añadido en `next.config.js` o `vercel.json`.
- [x] `Referrer-Policy` configurado (ej. `strict-origin-when-cross-origin` o `no-referrer`).
- [x] `Permissions-Policy` configurado (deshabilitando APIs que no usas).
- [x] `Content-Security-Policy` bien definida (y ajustada a tus recursos).
- [x] (Opcional) `X-XSS-Protection: 1; mode=block`.

Con todos estos pasos aplicados y verificados, tu frontend en Next.js desplegado en Vercel debería alcanzar una calificación **A** o **A+** en SecurityHeaders.

