import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmpleadosController } from './empleados.controller';
import { EmpleadosService } from './empleados.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmpleadosController],
  providers: [EmpleadosService],
  exports: [EmpleadosService],
})
export class EmpleadosModule {}
