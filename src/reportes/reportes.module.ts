import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PosModule } from '../pos/pos.module';
import { InventarioModule } from '../inventario/inventario.module';
import { ComisionesModule } from '../comisiones/comisiones.module';

@Module({
  imports: [PrismaModule, PosModule, InventarioModule, ComisionesModule],
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
