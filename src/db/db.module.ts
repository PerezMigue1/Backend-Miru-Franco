import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DbController } from './db.controller';
import { DbService } from './db.service';

@Module({
  imports: [PrismaModule],
  controllers: [DbController],
  providers: [DbService],
})
export class DbModule {}
