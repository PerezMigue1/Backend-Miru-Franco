import { Module } from '@nestjs/common';
import { PreguntaSeguridadController } from './pregunta-seguridad.controller';
import { PreguntaSeguridadService } from './pregunta-seguridad.service';

@Module({
  controllers: [PreguntaSeguridadController],
  providers: [PreguntaSeguridadService],
  exports: [PreguntaSeguridadService],
})
export class PreguntaSeguridadModule {}

