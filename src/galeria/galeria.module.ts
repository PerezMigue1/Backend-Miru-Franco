import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubidasModule } from '../subidas/subidas.module';
import { GaleriaController } from './galeria.controller';
import { GaleriaService } from './galeria.service';

/** Galería del salón: pública (GET /api/galeria) y su administración en Operaciones > Galería. */
@Module({
  imports: [PrismaModule, SubidasModule],
  controllers: [GaleriaController],
  providers: [GaleriaService],
})
export class GaleriaModule {}
