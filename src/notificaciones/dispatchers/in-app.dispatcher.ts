import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesSseService } from '../sse/notificaciones-sse.service';
import { CanalDispatcher, EnvioConNotificacion, ResultadoEnvio } from './canal-dispatcher.interface';

@Injectable()
export class InAppDispatcher implements CanalDispatcher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sse: NotificacionesSseService,
  ) {}

  async enviar(envio: EnvioConNotificacion): Promise<ResultadoEnvio> {
    await this.prisma.notificacionEnvio.update({
      where: { id: envio.id },
      data: { estado: 'enviada', enviadoEn: new Date() },
    });
    this.sse.emitir(envio.notificacion.usuarioId, envio.notificacion);
    return { exito: true };
  }
}
