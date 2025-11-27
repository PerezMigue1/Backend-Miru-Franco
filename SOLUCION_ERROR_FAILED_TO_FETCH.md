# 🔧 Solución: Error "Failed to fetch" en pregunta-seguridad

## 🔍 Problema Identificado

El error `Failed to fetch` al cargar preguntas de seguridad puede tener varias causas:

1. **CORS no configurado** en el backend
2. **URL incorrecta** o mal construida
3. **Backend no disponible** o no responde
4. **Endpoint no existe** en el backend

## ✅ Soluciones

### Solución 1: Verificar que el endpoint existe en el backend

Abre en tu navegador:
```
https://miru-franco.onrender.com/api/pregunta-seguridad
```

**✅ Si funciona:** Deberías ver un JSON con las preguntas de seguridad
**❌ Si no funciona:** El endpoint no existe o el backend no está disponible

### Solución 2: Verificar CORS en el backend

El backend debe tener CORS configurado para permitir solicitudes desde el frontend.

**En NestJS (`src/main.ts`):**

```typescript
app.enableCors({
  origin: [
    'https://miru-franco.vercel.app',
    'http://localhost:3000',
    // ... otros orígenes permitidos
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

### Solución 3: Verificar la URL en el frontend

Abre la consola del navegador (F12) y busca los logs:
```
[API Client] GET - endpoint: /api/pregunta-seguridad, customBase: https://miru-franco.onrender.com
[API Client] GET https://miru-franco.onrender.com/api/pregunta-seguridad
```

**✅ URL correcta:** `https://miru-franco.onrender.com/api/pregunta-seguridad`
**❌ URL incorrecta:** Si ves algo diferente, hay un problema con la configuración

### Solución 4: Verificar variable de entorno

En Vercel, verifica que `NEXT_PUBLIC_API_URL` esté configurada:
```
NEXT_PUBLIC_API_URL=https://miru-franco.onrender.com
```

**Importante:** No debe tener barra final (`/`)

### Solución 5: Probar directamente en el navegador

Abre la consola del navegador y ejecuta:

```javascript
fetch('https://miru-franco.onrender.com/api/pregunta-seguridad')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
```

**✅ Si funciona:** El endpoint existe y CORS está configurado
**❌ Si falla:** Hay un problema con CORS o el endpoint no existe

### Solución 6: Verificar logs del backend

Revisa los logs de Render para ver si:
- El backend está recibiendo la solicitud
- Hay errores en el backend
- El endpoint está registrado correctamente

## 🔍 Diagnóstico

### Paso 1: Verificar en la consola del navegador

1. Abre la consola (F12)
2. Busca los logs que empiezan con `[API Client]`
3. Copia la URL que se está intentando usar
4. Prueba esa URL directamente en el navegador

### Paso 2: Verificar respuesta del backend

Si puedes acceder a la URL directamente, verifica:
- ¿Devuelve JSON?
- ¿Tiene el formato esperado?
- ¿Hay errores en la respuesta?

### Paso 3: Verificar CORS

Si la URL funciona directamente pero falla desde el frontend, es un problema de CORS.

**Síntomas de CORS:**
- Error en consola: `Access to fetch at '...' from origin '...' has been blocked by CORS policy`
- La solicitud aparece en Network tab pero falla
- El backend recibe la solicitud pero el navegador bloquea la respuesta

## 📝 Checklist

- [ ] El endpoint `/api/pregunta-seguridad` existe en el backend
- [ ] CORS está configurado en el backend para permitir el frontend
- [ ] La variable `NEXT_PUBLIC_API_URL` está configurada en Vercel
- [ ] La URL construida es correcta (ver logs en consola)
- [ ] El backend está disponible y respondiendo
- [ ] No hay errores en los logs del backend

## 🚀 Próximos Pasos

1. Verifica que el endpoint existe probándolo directamente
2. Si existe, verifica CORS en el backend
3. Si CORS está bien, verifica los logs del frontend para ver la URL exacta
4. Compara la URL del log con la URL que funciona directamente

