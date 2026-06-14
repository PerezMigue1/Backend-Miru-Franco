import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SeguimientosController } from './seguimientos.controller';
import { SeguimientosService } from './seguimientos.service';

@Module({
  imports: [PrismaModule],
  controllers: [SeguimientosController],
  providers: [SeguimientosService],
  exports: [SeguimientosService],
})
export class SeguimientosModule {}
