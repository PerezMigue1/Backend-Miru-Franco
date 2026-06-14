import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PermisosController } from './permisos.controller';
import { PermisosService } from './permisos.service';

@Module({
  imports: [PrismaModule],
  controllers: [PermisosController],
  providers: [PermisosService],
  exports: [PermisosService],
})
export class PermisosModule {}
