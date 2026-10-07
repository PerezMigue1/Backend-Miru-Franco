import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { EmailModule } from '../email/email.module';
import { SecurityModule } from '../common/services/security.module';
import { JWT_TTL_SEGUNDOS } from '../auth/jwt-ttl';
import { jwtSecretObligatorio } from '../auth/jwt-secret';

@Module({
  imports: [
    EmailModule,
    SecurityModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: jwtSecretObligatorio(configService.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: JWT_TTL_SEGUNDOS },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UsuariosController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}

