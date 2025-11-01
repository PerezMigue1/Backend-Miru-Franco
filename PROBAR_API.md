# 🧪 Cómo Probar tu API Backend

## 🔗 URLs Base

**Producción:** `https://backend-miru-franco.vercel.app`
**Desarrollo Local:** `http://localhost:3001`

---

## ✅ Paso 1: Verificar que el Backend Funciona

### Desde el Navegador:
Abre en tu navegador:
```
https://backend-miru-franco.vercel.app/
```

**Respuesta esperada:**
```json
{
  "message": "API Backend Miru funcionando correctamente",
  "version": "1.0.0",
  "status": "active"
}
```

### Desde la Terminal (PowerShell):
```powershell
curl.exe https://backend-miru-franco.vercel.app/
```

---

## 👥 Paso 2: Ver la Colección de Usuarios

### Opción A: Desde el Navegador
Abre en tu navegador:
```
https://backend-miru-franco.vercel.app/api/users
```

### Opción B: Desde PowerShell (curl)
```powershell
curl.exe https://backend-miru-franco.vercel.app/api/users
```

### Opción C: Desde PowerShell (Invoke-WebRequest)
```powershell
Invoke-WebRequest -Uri "https://backend-miru-franco.vercel.app/api/users" | Select-Object -ExpandProperty Content
```

**Respuesta esperada:**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "nombre": "María González Pérez",
      "email": "maria.gonzalez@email.com",
      "telefono": "+521234567890",
      "fechaNacimiento": "1995-05-15T00:00:00.000Z",
      "preguntaSeguridad": "¿Cuál era el nombre de tu primera mascota?",
      "direccion": {
        "calle": "Av. Insurgentes",
        "numero": "123",
        "colonia": "Del Valle",
        "codigoPostal": "03100",
        "referencia": "Entre calle A y calle B, edificio azul"
      },
      "perfilCapilar": {
        "tipoCabello": "rizado",
        "tieneAlergias": true,
        "alergias": "Alérgico a tintes con amoniaco",
        "tratamientosQuimicos": true,
        "tratamientos": "Alisado realizado hace 3 meses"
      },
      "aceptaAvisoPrivacidad": true,
      "recibePromociones": true,
      "creadoEn": "2024-01-15T10:30:00.000Z",
      "actualizadoEn": "2024-01-15T10:30:00.000Z",
      "activo": true
    }
  ]
}
```

**Si no hay usuarios:**
```json
{
  "success": true,
  "count": 0,
  "data": []
}
```

---

## ➕ Paso 3: Crear un Usuario (Si no hay ninguno)

### Desde PowerShell:

```powershell
$body = @{
    nombre = "Test User"
    email = "test@example.com"
    telefono = "+521234567890"
    password = "password123"
    fechaNacimiento = "1995-05-15"
    preguntaSeguridad = "¿Cuál es tu color favorito?"
    direccion = @{
        calle = "Test Street"
        numero = "123"
        colonia = "Test Colonia"
        codigoPostal = "12345"
        referencia = "Test referencia"
    }
    perfilCapilar = @{
        tipoCabello = "liso"
        tieneAlergias = $false
        tratamientosQuimicos = $false
    }
    aceptaAvisoPrivacidad = $true
    recibePromociones = $false
} | ConvertTo-Json -Depth 10

Invoke-WebRequest -Uri "https://backend-miru-franco.vercel.app/api/users" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

### Desde curl (más simple):
```powershell
curl.exe -X POST https://backend-miru-franco.vercel.app/api/users `
  -H "Content-Type: application/json" `
  -d '{\"nombre\":\"Test User\",\"email\":\"test@example.com\",\"telefono\":\"+521234567890\",\"password\":\"password123\",\"fechaNacimiento\":\"1995-05-15\",\"preguntaSeguridad\":\"Test question\",\"direccion\":{\"calle\":\"Test\",\"numero\":\"123\",\"colonia\":\"Test\",\"codigoPostal\":\"12345\",\"referencia\":\"Test\"},\"perfilCapilar\":{\"tipoCabello\":\"liso\",\"tieneAlergias\":false,\"tratamientosQuimicos\":false},\"aceptaAvisoPrivacidad\":true,\"recibePromociones\":false}'
```

**Respuesta esperada:**
```json
{
  "success": true,
  "message": "Usuario creado correctamente",
  "token": "eyJhbGc...",
  "usuario": {
    "_id": "65abc123def4567890123456",
    "nombre": "Test User",
    "email": "test@example.com"
  }
}
```

---

## 🔍 Paso 4: Obtener un Usuario Específico por ID

Reemplaza `USER_ID` con el ID real del usuario:

```
https://backend-miru-franco.vercel.app/api/users/USER_ID
```

Ejemplo:
```
https://backend-miru-franco.vercel.app/api/users/507f1f77bcf86cd799439011
```

---

## 🧪 Usando Postman o Thunder Client (VS Code)

### Crear colección en Postman:

1. **GET - Verificar Estado**
   - URL: `https://backend-miru-franco.vercel.app/`
   - Method: GET

2. **GET - Obtener Usuarios**
   - URL: `https://backend-miru-franco.vercel.app/api/users`
   - Method: GET

3. **POST - Crear Usuario**
   - URL: `https://backend-miru-franco.vercel.app/api/users`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Body (raw JSON):
   ```json
   {
     "nombre": "Test User",
     "email": "test@example.com",
     "telefono": "+521234567890",
     "password": "password123",
     "fechaNacimiento": "1995-05-15",
     "preguntaSeguridad": "¿Cuál es tu color favorito?",
     "direccion": {
       "calle": "Test Street",
       "numero": "123",
       "colonia": "Test Colonia",
       "codigoPostal": "12345",
       "referencia": "Test referencia"
     },
     "perfilCapilar": {
       "tipoCabello": "liso",
       "tieneAlergias": false,
       "tratamientosQuimicos": false
     },
     "aceptaAvisoPrivacidad": true,
     "recibePromociones": false
   }
   ```

---

## 🐛 Verificar Logs en Vercel

Si algo no funciona:

1. Ve a: https://vercel.com/miru-franco/backend-miru-franco
2. Clic en **"Deployments"**
3. Clic en el deployment más reciente
4. Clic en **"Functions"**
5. Clic en `api/index.js` para ver los logs

---

## ✅ Checklist de Verificación

- [ ] Endpoint raíz (`/`) responde correctamente
- [ ] Endpoint `/api/users` muestra usuarios (puede estar vacío)
- [ ] Puedo crear un nuevo usuario
- [ ] Puedo obtener un usuario por ID
- [ ] Los logs en Vercel no muestran errores de MongoDB
- [ ] Las variables de entorno están configuradas en Vercel

---

## 💡 Tip: Formato JSON en el Navegador

Para ver el JSON formateado en el navegador, instala una extensión como:
- **JSON Formatter** (Chrome/Edge)
- **JSON Viewer** (Firefox)

O usa el navegador en modo desarrollador (F12) → Network → Response

