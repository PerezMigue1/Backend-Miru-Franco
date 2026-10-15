import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SubidasModule } from '../subidas/subidas.module';

@Module({
  imports: [PrismaModule, SubidasModule],
  controllers: [ProductosController],
  providers: [ProductosService],
  exports: [ProductosService],
})
export class ProductosModule {}

