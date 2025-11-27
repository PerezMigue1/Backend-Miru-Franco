import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { PrismaModule } from './prisma/prisma.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { AuthModule } from './auth/auth.module';
import { PreguntaSeguridadModule } from './pregunta-seguridad/pregunta-seguridad.module';
import { EmailModule } from './email/email.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    // Configuración global
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [databaseConfig],
      cache: true,
    }),
    // Módulos de base de datos
    PrismaModule,
    // Módulos de funcionalidad
    EmailModule,
    UsuariosModule,
    AuthModule,
    PreguntaSeguridadModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

