import { Module } from '@nestjs/common';
import { ConfiguracionSitioModule } from '../configuracion-sitio/configuracion-sitio.module';
import { TextosSitioController } from './textos-sitio.controller';
import { TextosSitioService } from './textos-sitio.service';

/** Textos del sitio administrables: catálogo, edición con historial y carga en memoria para correos y avisos. */
@Module({
  imports: [ConfiguracionSitioModule],
  controllers: [TextosSitioController],
  providers: [TextosSitioService],
  exports: [TextosSitioService],
})
export class TextosSitioModule {}
