import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Prefijo global para todas las rutas
  app.setGlobalPrefix('api', {
    exclude: ['/salud', '/', '/v1'],
  });
  
  // Configurar ruta de health check (excluida del prefijo global)
  app.use('/salud', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  
  // Versionado de API (opcional)
  // Deshabilitado temporalmente para rutas sin versión
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  
  // Habilitar CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });

  // Filtro global de excepciones
  app.useGlobalFilters(new HttpExceptionFilter());

  // Validación global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
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
