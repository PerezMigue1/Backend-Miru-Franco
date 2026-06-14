import { Module } from '@nestjs/common';
import { CitasController } from './citas.controller';
import { CitasService } from './citas.service';
import { PrismaModule } from '../prisma/prisma.module';
import { InventarioModule } from '../inventario/inventario.module';

@Module({
  imports: [PrismaModule, InventarioModule],
  controllers: [CitasController],
  providers: [CitasService],
  exports: [CitasService],
})
export class CitasModule {}
