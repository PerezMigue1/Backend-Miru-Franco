import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
const cookieParser = require('cookie-parser');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
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
    'http://localhost:3000',
    'http://localhost:3001',
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

  // Validación global con sanitización
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remueve propiedades no definidas en el DTO
      forbidNonWhitelisted: true, // Rechaza propiedades no definidas
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: process.env.NODE_ENV === 'production', // Ocultar mensajes detallados en producción
    }),
  );


  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Servidor corriendo en el puerto ${port}`);
  console.log(`📝 API disponible en http://localhost:${port}/api`);
  console.log(`✅ Módulos cargados correctamente`);
  console.log(`🔍 Prueba estas rutas:`);
  console.log(`   - GET /api/auth/test (debería funcionar)`);
  console.log(`   - GET /api/auth/google (OAuth)`);
}

bootstrap();
