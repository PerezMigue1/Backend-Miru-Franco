import { Module } from '@nestjs/common';
import { CitasController } from './citas.controller';
import { CitasService } from './citas.service';
import { PrismaModule } from '../prisma/prisma.module';
import { InventarioModule } from '../inventario/inventario.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { ModeloCancelacionService } from './modelo-cancelacion.service';
import { RiesgoCancelacionService } from './riesgo-cancelacion.service';

@Module({
  imports: [PrismaModule, InventarioModule, ConfiguracionModule],
  controllers: [CitasController],
  providers: [
    CitasService,
    ModeloCancelacionService,
    RiesgoCancelacionService,
  ],
  exports: [CitasService, RiesgoCancelacionService],
})
export class CitasModule {}
