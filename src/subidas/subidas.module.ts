import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryGaleria } from '../galeria/cloudinary-galeria';
import { ImagenesSubidasController } from './imagenes-subidas.controller';
import { ImagenesSubidasService } from './imagenes-subidas.service';

/** Subida segura de imágenes (firma del servidor y registro solo de subidas propias). La usan la galería y los formularios. */
@Module({
  imports: [PrismaModule],
  controllers: [ImagenesSubidasController],
  providers: [ImagenesSubidasService, CloudinaryGaleria],
  exports: [ImagenesSubidasService, CloudinaryGaleria],
})
export class SubidasModule {}
