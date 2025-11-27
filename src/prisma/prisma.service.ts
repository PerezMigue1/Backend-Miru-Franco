import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: configService.get<string>('MONGODB_URI'),
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma conectado a MongoDB');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

