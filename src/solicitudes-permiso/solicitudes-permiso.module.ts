import { Module } from '@nestjs/common';
import { SolicitudesPermisoController } from './solicitudes-permiso.controller';
import { SolicitudesPermisoService } from './solicitudes-permiso.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SolicitudesPermisoController],
  providers: [SolicitudesPermisoService],
  exports: [SolicitudesPermisoService],
})
export class SolicitudesPermisoModule {}
