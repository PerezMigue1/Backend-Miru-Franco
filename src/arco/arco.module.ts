import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { ArcoController } from './arco.controller';
import { ArcoService } from './arco.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [ArcoController],
  providers: [ArcoService],
  exports: [ArcoService],
})
export class ArcoModule {}
