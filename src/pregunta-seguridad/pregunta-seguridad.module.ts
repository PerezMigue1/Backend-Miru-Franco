import { Module } from '@nestjs/common';
import { PreguntaSeguridadController } from './pregunta-seguridad.controller';
import { PreguntaSeguridadService } from './pregunta-seguridad.service';
import { EmailModule } from '../email/email.module';

@Module({
  // EmailModule: aviso por correo cuando cambia la pregunta de seguridad de la cuenta.
  imports: [EmailModule],
  controllers: [PreguntaSeguridadController],
  providers: [PreguntaSeguridadService],
  exports: [PreguntaSeguridadService],
})
export class PreguntaSeguridadModule {}
