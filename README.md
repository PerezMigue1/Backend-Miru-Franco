# Backend Miru

Backend API desarrollado con Node.js, Express, MongoDB y desplegado en Vercel.

## 🚀 Instalación Local

1. **Instalar las dependencias:**
```bash
npm install
```

2. **Configurar variables de entorno:**
```bash
# Copiar archivo de ejemplo
copy env.example .env

# Editar .env y agregar tu connection string de MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database_name?retryWrites=true&w=majority
```

3. **Iniciar el servidor:**
```bash
# Modo desarrollo (con nodemon)
npm run dev

# Modo producción
npm start
```

El servidor estará disponible en `http://localhost:3000`

## 🗄️ Configuración de MongoDB

### Opción 1: MongoDB Atlas (Recomendado para producción)

1. Crea una cuenta en [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Crea un nuevo cluster (el tier gratuito es suficiente para empezar)
3. Configura acceso de red (añade `0.0.0.0/0` para permitir conexiones desde cualquier lugar)
4. Crea un usuario de base de datos
5. Obtén tu connection string y actualiza `MONGODB_URI` en tu `.env`

### Opción 2: MongoDB Local

Si prefieres usar MongoDB localmente:

```bash
# Instalar MongoDB localmente
# Seguir instrucciones en: https://www.mongodb.com/try/download/community

# Connection string local
MONGODB_URI=mongodb://localhost:27017/miru_db
```

## 🚀 Despliegue en Vercel

### Pasos para desplegar:

1. **Instalar Vercel CLI:**
```bash
npm install -g vercel
```

2. **Iniciar sesión en Vercel:**
```bash
vercel login
```

3. **Desplegar:**
```bash
vercel
```

4. **Configurar variables de entorno en Vercel:**

Ve al dashboard de Vercel → Settings → Environment Variables y añade:
- `MONGODB_URI`: Tu connection string de MongoDB Atlas

5. **Desplegar a producción:**
```bash
vercel --prod
```

### Alternativa: Desplegar desde GitHub

1. Sube tu código a un repositorio de GitHub
2. En [vercel.com](https://vercel.com), importa tu repositorio
3. Agrega las variables de entorno en la configuración del proyecto
4. Vercel desplegará automáticamente en cada push

## 📁 Estructura del Proyecto

```
backend-miru/
├── server.js              # Punto de entrada principal
├── package.json           # Dependencias y scripts
├── vercel.json           # Configuración de Vercel
├── .env                   # Variables de entorno (no se sube a git)
├── .gitignore            # Archivos ignorados por git
├── config/               # Configuraciones
│   └── database.js       # Conexión a MongoDB
├── routes/               # Rutas de la API
│   └── userRoutes.js
├── controllers/          # Lógica de negocio
│   └── userController.js
├── models/               # Modelos de datos (Mongoose)
│   └── User.js
├── middleware/           # Middlewares personalizados
│   ├── errorHandler.js
│   └── notFound.js
└── README.md
```

## 🔗 Endpoints de la API

### Base URL
- **Local:** `http://localhost:3000`
- **Vercel:** `https://tu-proyecto.vercel.app`

### Usuarios

- `GET /` - Verificar estado de la API
- `GET /api/users` - Obtener todos los usuarios
- `GET /api/users/:id` - Obtener un usuario por ID
- `POST /api/users` - Crear un nuevo usuario
- `PUT /api/users/:id` - Actualizar un usuario
- `DELETE /api/users/:id` - Eliminar un usuario

### Ejemplos de uso

```bash
# Verificar estado
curl https://tu-proyecto.vercel.app/

# Obtener todos los usuarios
curl https://tu-proyecto.vercel.app/api/users

# Crear un usuario
curl -X POST https://tu-proyecto.vercel.app/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Juan Pérez", "email": "juan@example.com"}'

# Obtener usuario por ID
curl https://tu-proyecto.vercel.app/api/users/65abc123def4567890123456

# Actualizar usuario
curl -X PUT https://tu-proyecto.vercel.app/api/users/65abc123def4567890123456 \
  -H "Content-Type: application/json" \
  -d '{"name": "Juan Carlos Pérez"}'

# Eliminar usuario
curl -X DELETE https://tu-proyecto.vercel.app/api/users/65abc123def4567890123456
```

## 🛠️ Tecnologías Utilizadas

- **Node.js** - Runtime de JavaScript
- **Express** - Framework web
- **MongoDB** - Base de datos NoSQL
- **Mongoose** - ODM para MongoDB
- **CORS** - Manejo de políticas de origen cruzado
- **Morgan** - Logger HTTP
- **dotenv** - Variables de entorno
- **Nodemon** - Recarga automática en desarrollo
- **Vercel** - Plataforma de despliegue

## 📝 Características

- ✅ CRUD completo para usuarios
- ✅ Validación de datos con Mongoose
- ✅ Manejo centralizado de errores
- ✅ Conexión automática a MongoDB
- ✅ Preparado para despliegue en Vercel
- ✅ Variables de entorno configuradas
- ✅ CORS habilitado para APIs
- ✅ Logs de desarrollo con Morgan

## 🔐 Seguridad

- Las variables de entorno no se suben a git
- Validación de datos en modelos
- Índices en campos únicos para optimización
- Manejo de errores sin exponer información sensible

## 🤝 Próximos Pasos

Algunas mejoras que puedes agregar:

- [ ] Autenticación con JWT
- [ ] Validación más robusta con joi o express-validator
- [ ] Paginación en listados
- [ ] Búsqueda y filtros
- [ ] Tests unitarios e integración
- [ ] Rate limiting
- [ ] Documentación con Swagger
- [ ] Logging más avanzado

## 📄 Licencia

ISC
