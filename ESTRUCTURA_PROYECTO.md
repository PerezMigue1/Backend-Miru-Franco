# Estructura del Proyecto

Esta es la estructura final del proyecto Backend Miru Franco organizada según las mejores prácticas de NestJS.

## 📁 Estructura de Directorios

```
backend-miru/
├── src/                          # Código fuente principal
│   ├── main.ts                   # Punto de entrada de la aplicación
│   ├── app.module.ts             # Módulo raíz de la aplicación
│   │
│   ├── common/                   # Elementos compartidos
│   │   ├── decorators/           # Decoradores personalizados
│   │   │   ├── current-user.decorator.ts
│   │   │   └── index.ts
│   │   ├── filters/              # Filtros de excepciones
│   │   │   ├── http-exception.filter.ts
│   │   │   └── index.ts
│   │   ├── guards/               # Guards de autenticación
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── index.ts
│   │   ├── interfaces/           # Interfaces TypeScript
│   │   │   ├── usuario.interface.ts
│   │   │   └── index.ts
│   │   └── index.ts              # Barrel export
│   │
│   ├── config/                   # Configuraciones
│   │   └── database.config.ts    # Configuración de base de datos
│   │
│   ├── prisma/                   # Módulo Prisma
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   │
│   ├── usuarios/                 # Módulo de usuarios
│   │   ├── dto/                  # Data Transfer Objects
│   │   │   ├── create-usuario.dto.ts
│   │   │   ├── update-usuario.dto.ts
│   │   │   ├── login.dto.ts
│   │   │   ├── verificar-otp.dto.ts
│   │   │   ├── reenviar-codigo.dto.ts
│   │   │   ├── verificar-correo.dto.ts
│   │   │   ├── obtener-pregunta.dto.ts
│   │   │   ├── validar-respuesta.dto.ts
│   │   │   ├── cambiar-password.dto.ts
│   │   │   └── cambiar-password-perfil.dto.ts
│   │   ├── usuarios.controller.ts
│   │   ├── usuarios.service.ts
│   │   └── usuarios.module.ts
│   │
│   ├── auth/                     # Módulo de autenticación
│   │   ├── strategies/           # Estrategias de Passport
│   │   │   ├── google.strategy.ts
│   │   │   └── jwt.strategy.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.module.ts
│   │
│   ├── pregunta-seguridad/       # Módulo de preguntas de seguridad
│   │   ├── dto/
│   │   │   ├── create-pregunta.dto.ts
│   │   │   ├── update-pregunta.dto.ts
│   │   │   └── verificar-respuesta.dto.ts
│   │   ├── pregunta-seguridad.controller.ts
│   │   ├── pregunta-seguridad.service.ts
│   │   └── pregunta-seguridad.module.ts
│   │
│   └── email/                    # Módulo de email
│       ├── email.service.ts
│       └── email.module.ts
│
├── prisma/                       # Prisma ORM
│   └── schema.prisma             # Schema de base de datos
│
├── ayuda/                        # Documentación de ayuda
├── .env                          # Variables de entorno (no commiteable)
├── .gitignore                    # Archivos ignorados por Git
├── nest-cli.json                 # Configuración de NestJS CLI
├── package.json                  # Dependencias del proyecto
├── render.yaml                   # Configuración de Render
├── tsconfig.json                 # Configuración de TypeScript
├── README.md                     # Documentación principal
└── ESTRUCTURA_PROYECTO.md        # Este archivo
```

## 🎯 Descripción de Carpetas

### `src/common/`
Contiene elementos compartidos entre módulos:
- **decorators/**: Decoradores personalizados como `@CurrentUser()`
- **filters/**: Filtros de excepciones globales
- **guards/**: Guards de autenticación y autorización
- **interfaces/**: Interfaces TypeScript compartidas

### `src/config/`
Configuraciones de la aplicación (base de datos, etc.)

### `src/prisma/`
Módulo que proporciona el servicio de Prisma a toda la aplicación

### `src/usuarios/`
Módulo completo de gestión de usuarios con:
- CRUD de usuarios
- Autenticación y login
- Verificación OTP
- Recuperación de contraseña
- Gestión de perfiles

### `src/auth/`
Módulo de autenticación:
- Google OAuth
- JWT tokens
- Estrategias de Passport

### `src/pregunta-seguridad/`
Módulo para gestión de preguntas de seguridad

### `src/email/`
Servicio de envío de emails con SendGrid

## 📝 Convenciones

### Nombres de Archivos
- **Módulos**: `*.module.ts`
- **Controladores**: `*.controller.ts`
- **Servicios**: `*.service.ts`
- **DTOs**: `*.dto.ts`
- **Guards**: `*.guard.ts`
- **Filters**: `*.filter.ts`
- **Interfaces**: `*.interface.ts`

### Estructura de Módulos
Cada módulo contiene:
1. `*.module.ts` - Definición del módulo
2. `*.service.ts` - Lógica de negocio
3. `*.controller.ts` - Endpoints HTTP
4. `dto/` - Data Transfer Objects para validación
5. Otras carpetas según necesidades (strategies, guards, etc.)

## 🔒 Seguridad

- **Guards**: Protegen rutas que requieren autenticación
- **DTOs**: Validan datos de entrada con `class-validator`
- **Filters**: Manejan excepciones de forma consistente
- **Decorators**: Simplifican acceso a datos del request

## 📦 Dependencias Principales

- **@nestjs/common**: Funcionalidades core de NestJS
- **@nestjs/core**: Motor de NestJS
- **@prisma/client**: Cliente de Prisma
- **@sendgrid/mail**: Servicio de email
- **passport**: Autenticación
- **bcryptjs**: Hashing de contraseñas
- **class-validator**: Validación de DTOs

## 🚀 Scripts Disponibles

```bash
npm run build          # Compilar proyecto
npm run start:prod     # Ejecutar en producción
npm run start:dev      # Ejecutar en desarrollo con hot-reload
npm run prisma:generate # Generar Prisma Client
```

## 📚 Más Información

Ver `README.md` para documentación completa de la API y configuración.

