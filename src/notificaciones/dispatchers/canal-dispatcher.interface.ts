import { Prisma } from '@prisma/client';

export type EnvioConNotificacion = Prisma.NotificacionEnvioGetPayload<{
  include: { notificacion: true };
}>;

export interface ResultadoEnvio {
  exito: boolean;
}

export interface CanalDispatcher {
  enviar(envio: EnvioConNotificacion): Promise<ResultadoEnvio>;
}
