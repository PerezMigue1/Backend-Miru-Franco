import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubidasModule } from '../subidas/subidas.module';
import { ContenidoAdminController, ContenidoPublicoController } from './contenido.controller';
import { ContenidoService } from './contenido.service';

/** Contenido público administrable (Admin > Contenido): promociones, preguntas frecuentes y equipo. */
@Module({
  imports: [PrismaModule, SubidasModule],
  controllers: [ContenidoPublicoController, ContenidoAdminController],
  providers: [ContenidoService],
})
export class ContenidoModule {}
