import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QuejasController } from './quejas.controller';
import { QuejasService } from './quejas.service';

@Module({
  imports: [PrismaModule],
  controllers: [QuejasController],
  providers: [QuejasService],
  exports: [QuejasService],
})
export class QuejasModule {}
