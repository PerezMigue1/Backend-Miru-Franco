import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { OutboxService } from './outbox.service';
import { ResolverDestinatariosService } from './resolver-destinatarios.service';
import { DespachadorService } from './despachador.service';
import { BarridoService } from './barrido.service';
import { InAppDispatcher } from './dispatchers/in-app.dispatcher';
import { EmailDispatcher } from './dispatchers/email.dispatcher';
import { NotificacionesListener } from './notificaciones.listener';
import { NotificacionesSseService } from './sse/notificaciones-sse.service';

/**
 * Motor de despacho de notificaciones (Outbox + resolver + dispatcher +
 * listener de eventos de dominio + bus SSE). Distinto del
 * NotificacionesService en src/ecommerce/notificaciones/, que es el CRUD de
 * la campanita y no se toca aquí.
 *
 * Solo se exporta NotificacionesSseService: es lo único que otro módulo
 * necesita (el controller existente de la campanita, para el endpoint
 * GET /notificaciones/stream del bloque 6 — ver notas de ecommerce.module.ts).
 * El resto (Outbox, resolver, despachador, listener) es interno a este
 * módulo: el listener reacciona solo a eventos emitidos por otros services vía
 * EventEmitter2, no necesita ser invocado directamente desde fuera.
 */
@Module({
  imports: [PrismaModule, EmailModule],
  providers: [
    OutboxService,
    ResolverDestinatariosService,
    DespachadorService,
    BarridoService,
    InAppDispatcher,
    EmailDispatcher,
    NotificacionesListener,
    NotificacionesSseService,
  ],
  exports: [NotificacionesSseService],
})
export class NotificacionesModule {}
