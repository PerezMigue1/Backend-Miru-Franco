import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { SubidasController } from './subidas.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { SecurityModule } from '../common/services/security.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JWT_TTL_SEGUNDOS } from './jwt-ttl';
import { jwtSecretObligatorio } from './jwt-secret';
import { SesionesMovilesService } from './sesiones-moviles.service';

@Module({
  imports: [
    PassportModule, // Registrar sin defaultStrategy para permitir múltiples estrategias
    UsuariosModule,
    SecurityModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: jwtSecretObligatorio(configService.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: JWT_TTL_SEGUNDOS },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, SubidasController],
  providers: [AuthService, GoogleStrategy, JwtStrategy, SesionesMovilesService],
  exports: [AuthService],
})
export class AuthModule {
  constructor() {
    console.log('✅ AuthModule inicializado');
  }
}

