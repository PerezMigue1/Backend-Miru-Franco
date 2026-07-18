import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [OauthController],
  providers: [OauthService],
})
export class OauthModule {}
