import { Module } from '@nestjs/common';
import { PaquetesService } from './paquetes.service';
import { PaquetesController } from './paquetes.controller';
import { PrismaModule } from '../prisma/prisma.module'; // Importante para la conexión

@Module({
  imports: [PrismaModule],
  controllers: [PaquetesController],
  providers: [PaquetesService],
})
export class PaquetesModule {}