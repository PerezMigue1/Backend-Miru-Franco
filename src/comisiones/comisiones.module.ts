import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ComisionesController } from './comisiones.controller';
import { ComisionesService } from './comisiones.service';

@Module({
  imports: [PrismaModule],
  controllers: [ComisionesController],
  providers: [ComisionesService],
  exports: [ComisionesService],
})
export class ComisionesModule {}
