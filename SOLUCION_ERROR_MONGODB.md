# 🔧 Solución: Error de Autenticación MongoDB en Vercel

## ❌ Error que estás viendo:
```
bad auth : authentication failed
code: 8000
```

## 🔍 Causa del Problema

El error indica que MongoDB Atlas está rechazando las credenciales. Las causas más comunes son:

1. **El carácter `>` en la contraseña no está codificado como `%3E`**
2. **Espacios adicionales** al copiar/pegar en Vercel
3. **Caracteres especiales** no codificados correctamente
4. **Usuario o contraseña incorrectos** en la variable de entorno

---

## ✅ SOLUCIÓN PASO A PASO

### Paso 1: Verificar tu Connection String Original

Tu connection string CORRECTO es:
```
mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
```

**✅ CORRECTO:** No necesita codificación especial. La contraseña es `mildred30` (sin caracteres especiales).

### Paso 2: Connection String para Vercel

En Vercel, debes usar **EXACTAMENTE** esto:

```
mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
```

**Base de datos:** `estetica-miru-franco`

### Paso 3: Verificar en Vercel

1. Ve a: https://vercel.com/miru-franco/backend-miru-franco
2. **Settings** → **Environment Variables**
3. Busca la variable `MONGODB_URI`
4. **Haz clic en editar** (ícono de lápiz)
5. Verifica que el **Value** sea EXACTAMENTE:

```
mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
```

### Paso 4: Verificaciones Importantes

✅ **NO debe tener espacios** al inicio o final  
✅ **Base de datos:** `estetica-miru-franco`  
✅ **NO debe tener saltos de línea**  
✅ **Debe comenzar con `mongodb+srv://`**  
✅ **Debe terminar con `&appName=MiruFranco`**

### Paso 5: Si ya está correcto pero sigue fallando

#### Opción A: Eliminar y Recrear la Variable

1. **Elimina** la variable `MONGODB_URI` actual
2. **Crea una nueva** con el mismo nombre
3. **Copia y pega EXACTAMENTE** este valor:

```
mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
```

4. Selecciona todos los entornos: ☑️ Production ☑️ Preview ☑️ Development
5. **Save**

#### Opción B: Verificar en MongoDB Atlas

1. Ve a: https://cloud.mongodb.com
2. Selecciona tu cluster
3. **Database Access** → Busca el usuario `miru`
4. Verifica que:
   - El usuario existe
   - La contraseña es correcta (`mildred30>`)
   - El usuario tiene permisos de lectura/escritura
5. Si es necesario, **resetea la contraseña** y actualiza en Vercel

#### Opción C: Verificar Network Access en MongoDB Atlas

1. En MongoDB Atlas, ve a **Network Access**
2. Verifica que tengas:
   - `0.0.0.0/0` (permitir desde cualquier lugar)
   - O la IP específica de Vercel

---

## 🧪 Probar si está Correcto

### Opción 1: Verificar en los Logs de Vercel

1. Ve a **Deployments** → Último deployment
2. Clic en **Functions** → `api/index.js`
3. Busca en los logs:
   - ✅ `✅ MongoDB conectado` = **Funciona**
   - ❌ `❌ Error al conectar MongoDB` = **Sigue el problema**

### Opción 2: Probar la API

Si MongoDB se conecta correctamente, deberías poder:

```powershell
curl.exe https://backend-miru-franco.vercel.app/api/users
```

Si funciona, verás los usuarios o `{"success":true,"count":0,"data":[]}`

---

## 📝 Caracteres Especiales que Necesitan Codificación

Si tu contraseña tiene otros caracteres especiales, cómplelos así:

| Carácter | Codificación URL |
|----------|------------------|
| `>` | `%3E` |
| `<` | `%3C` |
| `&` | `%26` |
| `+` | `%2B` |
| `=` | `%3D` |
| ` ` (espacio) | `%20` |
| `#` | `%23` |
| `%` | `%25` |

---

## 🆘 Si Nada Funciona

### Verificar Credenciales Directamente

1. Intenta conectarte desde tu máquina local con:

```javascript
const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://miru:mildred30%3E@mirufranco.rsucbbc.mongodb.net/mirufranco?retryWrites=true&w=majority&appName=MiruFranco')
  .then(() => console.log('Conectado'))
  .catch(err => console.error('Error:', err));
```

Si funciona localmente pero no en Vercel = problema de configuración en Vercel  
Si no funciona ni localmente = problema con las credenciales de MongoDB

### Resetear Usuario en MongoDB Atlas

Si es necesario:

1. Ve a **Database Access**
2. Clic en el usuario `miru`
3. **Edit** → **Edit Password**
4. Genera una nueva contraseña **sin caracteres especiales** (más fácil)
5. Actualiza en Vercel

---

## ✅ Checklist Final

- [ ] Variable `MONGODB_URI` existe en Vercel
- [ ] El valor tiene `%3E` en lugar de `>`
- [ ] No hay espacios extra al inicio/final
- [ ] Variable aplica a Production, Preview y Development
- [ ] Redesplegado después de cambiar la variable
- [ ] MongoDB Atlas permite conexiones desde `0.0.0.0/0`
- [ ] Usuario `miru` existe y tiene permisos correctos

---

## 📞 Resumen Rápido

**Connection String Correcto:** En Vercel, usa exactamente:

```
mongodb+srv://miru:mildred30@mirufranco.rsucbbc.mongodb.net/estetica-miru-franco?retryWrites=true&w=majority&appName=MiruFranco
```

**Base de datos:** `estetica-miru-franco`

**Después:** Redesplega en Vercel y verifica los logs.

