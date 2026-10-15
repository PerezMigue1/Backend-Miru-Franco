import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConsentimientosController } from './consentimientos.controller';
import { ConsentimientosService } from './consentimientos.service';

@Module({
  imports: [PrismaModule],
  controllers: [ConsentimientosController],
  providers: [ConsentimientosService],
  exports: [ConsentimientosService],
})
export class ConsentimientosModule {}
