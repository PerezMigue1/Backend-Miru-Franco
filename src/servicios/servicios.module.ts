import { Module } from '@nestjs/common';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubidasModule } from '../subidas/subidas.module';

@Module({
  imports: [PrismaModule, SubidasModule],
  controllers: [ServiciosController],
  providers: [ServiciosService],
  exports: [ServiciosService],
})
export class ServiciosModule {}
