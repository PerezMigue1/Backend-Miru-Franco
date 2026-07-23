import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { ModeloClusteringService } from './modelo-clustering.service';
import { SegmentacionClientesService } from './segmentacion-clientes.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientesController],
  providers: [
    ClientesService,
    ModeloClusteringService,
    SegmentacionClientesService,
  ],
  exports: [ClientesService, SegmentacionClientesService],
})
export class ClientesModule {}
