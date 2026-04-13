import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import type { ValidationError } from 'class-validator';
const cookieParser = require('cookie-parser');

function flattenValidationErrors(
  validationErrors: ValidationError[],
  parentPath = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const err of validationErrors) {
    const path = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints && Object.keys(err.constraints).length > 0) {
      out[path] = Object.values(err.constraints)[0] ?? 'Campo inválido';
    }
    if (err.children?.length) {
      Object.assign(out, flattenValidationErrors(err.children, path));
    }
  }
  return out;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Evita exponer el framework en la cabecera X-Powered-By (alerta ZAP low)
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  
  // Cookie parser para CSRF tokens
  app.use(cookieParser());
  
  // Prefijo global para todas las rutas
  app.setGlobalPrefix('api', {
    exclude: ['/salud', '/'],
  });
  
  // Configurar ruta de health check (excluida del prefijo global)
  app.use('/salud', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  
  // Versionado de API deshabilitado por ahora para simplificar las rutas
  // app.enableVersioning({
  //   type: VersioningType.URI,
  //   defaultVersion: '1',
  // });
  
  // Habilitar CORS con múltiples orígenes permitidos
  const allowedOrigins = [
    'https://miru-franco.vercel.app',
    'https://miru-franco-pznm3jk0w-miru-franco.vercel.app',
    'https://miru-franco-4pdg1kua8-miru-franco.vercel.app', // URL de preview/deployment de Vercel
    'https://miru-franco-hri9o928g-miru-franco.vercel.app', // URL actual de Vercel
    'https://miru-franco-idhk1rz7d-miru-franco.vercel.app', // Nueva URL de Vercel
    'http://localhost:3000',
    'http://localhost:3001',
    'https://mirufranco.com',
    'https://www.mirufranco.com',
    process.env.FRONTEND_URL,
  ].filter(Boolean); // Remover valores undefined/null

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir solicitudes sin origin (ej: mobile apps, Postman)
      if (!origin) return callback(null, true);
      
      // Si no hay orígenes específicos configurados, permitir todos
      if (allowedOrigins.length === 0 || process.env.FRONTEND_URL === '*') {
        return callback(null, true);
      }
      
      // Verificar si el origen está permitido
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`⚠️ CORS: Origen bloqueado: ${origin}`);
        callback(null, true); // Permitir todos temporalmente para debugging
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
    exposedHeaders: ['Authorization'],
  });

  // Headers de seguridad HTTP
  app.use((req, res, next) => {
    // Evita filtrar tecnología del servidor cuando el runtime la incluya
    res.removeHeader('Server');

    // X-Content-Type-Options: previene MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // X-Frame-Options: previene clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // X-XSS-Protection: protección básica contra XSS (legacy)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Strict-Transport-Security: fuerza HTTPS (HSTS)
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }
    
    // Content-Security-Policy: previene XSS
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
    );
    
    // Referrer-Policy: controla información de referrer
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions-Policy: limita funcionalidades del navegador
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()',
    );
    
    next();
  });

  // Filtro global de excepciones
  app.useGlobalFilters(new HttpExceptionFilter());

  // Validación global: 400 con formato { success, error, message, errors } (guía 400/403/500)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: process.env.NODE_ENV === 'production',
      exceptionFactory: (validationErrors: ValidationError[]) => {
        const errors = flattenValidationErrors(validationErrors);
        return new BadRequestException({
          success: false,
          error: 'Errores de validación',
          message: 'Revisa los campos del formulario',
          errors,
        });
      },
    }),
  );


  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Servidor corriendo en el puerto ${port}`);
  console.log(`📝 API disponible en http://localhost:${port}/api`);
  console.log(`✅ Módulos cargados correctamente`);
  console.log(`🔍 Prueba estas rutas:`);
  console.log(`   - GET /api/auth/test (debería funcionar)`);
  console.log(`   - GET /api/auth/google (OAuth)`);
}

bootstrap();
