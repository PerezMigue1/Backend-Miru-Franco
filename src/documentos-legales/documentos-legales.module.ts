import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentosLegalesAdminController, DocumentosLegalesPublicoController } from './documentos-legales.controller';
import { DocumentosLegalesService } from './documentos-legales.service';

/** Documentos legales administrables: texto vigente público y Admin > Documentos legales. */
@Module({
  imports: [PrismaModule],
  controllers: [DocumentosLegalesPublicoController, DocumentosLegalesAdminController],
  providers: [DocumentosLegalesService],
  exports: [DocumentosLegalesService],
})
export class DocumentosLegalesModule {}
