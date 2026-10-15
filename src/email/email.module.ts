import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ConfiguracionSitioModule } from '../configuracion-sitio/configuracion-sitio.module';

@Module({
  imports: [ConfiguracionSitioModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}

