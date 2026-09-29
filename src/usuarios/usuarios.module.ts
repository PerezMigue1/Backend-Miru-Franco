import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { EmailModule } from '../email/email.module';
import { SecurityModule } from '../common/services/security.module';
import { JWT_TTL_SEGUNDOS } from '../auth/jwt-ttl';

@Module({
  imports: [
    EmailModule,
    SecurityModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'tu_secreto_temporal',
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

