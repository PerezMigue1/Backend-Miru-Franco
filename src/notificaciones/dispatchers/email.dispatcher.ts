import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { CanalDispatcher, EnvioConNotificacion, ResultadoEnvio } from './canal-dispatcher.interface';

/**
 * Plantilla mínima genérica a partir de `notificacion.titulo`/`mensaje` —
 * mismos colores/tipografía que las plantillas de `EmailService` (Etapa 2)
 * para que el correo se sienta de la misma marca, sin ser una copia de esas
 * plantillas (que tienen su propio contenido fijo, no aplican aquí).
 */
function armarHtml(titulo: string, mensaje: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="color: #710014; margin: 0;">Miru Franco Salón Beauty</h2>
      </div>
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h3 style="color: #161616; margin-top: 0;">${titulo}</h3>
        <p style="color: #495057; line-height: 1.6; white-space: pre-line;">${mensaje}</p>
      </div>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;">
        <p style="color: #6c757d; font-size: 12px; margin: 0;">
          Este es un correo automático, por favor no respondas.
        </p>
      </div>
    </div>
  `;
}

@Injectable()
export class EmailDispatcher implements CanalDispatcher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async enviar(envio: EnvioConNotificacion): Promise<ResultadoEnvio> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: envio.notificacion.usuarioId },
      select: { email: true },
    });
    // `Usuario.email` es obligatorio en el schema; si `usuario` viene null aquí
    // es porque el usuario ya no existe (debería ser imposible por el cascade
    // de `Notificacion`, ver schema) — dejar que falle y lo reintente el
    // barrido en vez de enmascararlo como enviado.
    if (!usuario) {
      throw new Error(`Usuario ${envio.notificacion.usuarioId} no encontrado`);
    }

    await this.emailService.sendNotificationEmail(
      usuario.email,
      envio.notificacion.titulo,
      armarHtml(envio.notificacion.titulo, envio.notificacion.mensaje),
    );

    await this.prisma.notificacionEnvio.update({
      where: { id: envio.id },
      data: { estado: 'enviada', enviadoEn: new Date() },
    });
    return { exito: true };
  }
}
