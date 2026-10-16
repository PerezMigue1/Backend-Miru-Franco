import { Module } from '@nestjs/common';
import { SubidasModule } from '../subidas/subidas.module';
import { ConfiguracionPublicaController, ConfiguracionSitioController, OperacionSitioController } from './configuracion-sitio.controller';
import { ConfiguracionSitioService } from './configuracion-sitio.service';

/** Configuración del sitio: lectura pública con caché y edición desde Admin con historial. */
@Module({
  imports: [SubidasModule],
  controllers: [ConfiguracionPublicaController, ConfiguracionSitioController, OperacionSitioController],
  providers: [ConfiguracionSitioService],
  exports: [ConfiguracionSitioService],
})
export class ConfiguracionSitioModule {}
