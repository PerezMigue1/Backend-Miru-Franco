import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { htmlAviso } from '../../email/plantillas-correo';
import { CanalDispatcher, EnvioConNotificacion, ResultadoEnvio } from './canal-dispatcher.interface';

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
    // de `Notificacion`, ver schema): dejar que falle y lo reintente el
    // barrido en vez de enmascararlo como enviado.
    if (!usuario) {
      throw new Error(`Usuario ${envio.notificacion.usuarioId} no encontrado`);
    }

    // Asunto y cuerpo: el título y el mensaje del aviso (salen del catálogo de Textos del sitio). El diseño, el nombre
    // del salón (Configuración del sitio) y el pie automático los pone htmlAviso.
    await this.emailService.sendNotificationEmail(
      usuario.email,
      envio.notificacion.titulo,
      htmlAviso(envio.notificacion.titulo, envio.notificacion.mensaje),
    );

    await this.prisma.notificacionEnvio.update({
      where: { id: envio.id },
      data: { estado: 'enviada', enviadoEn: new Date() },
    });
    return { exito: true };
  }
}
