import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { escaparHtml } from '../common/utils/security.util';

@Injectable()
export class EmailService {
  // Sin destinatario en los logs: el correo de la clienta es dato personal.
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      console.warn('⚠️ RESEND_API_KEY no configurada. Los emails no se enviarán.');
    }
  }

  async sendOTPEmail(correo: string, codigoOTP: string): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const fromName = this.configService.get<string>('RESEND_FROM_NAME') || 'Miru Franco Salón Beauty';

    if (!apiKey || !fromEmail || !this.resend) {
      throw new Error('Resend no está configurado. Por favor configura RESEND_API_KEY y RESEND_FROM_EMAIL.');
    }

    try {
      const { error } = await this.resend.emails.send({
        to: correo,
        from: `${fromName} <${fromEmail}>`,
        subject: 'Código de activación - Miru Franco',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">Bienvenido a Miru Franco Salón Beauty</h2>
            <p>Tu código de verificación es:</p>
            <div style="background-color: #f2f1ed; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
              <h1 style="color: #161616; font-size: 32px; letter-spacing: 8px; margin: 0;">${codigoOTP}</h1>
            </div>
            <p style="color: #666;">Ingresa este código en la aplicación para activar tu cuenta.</p>
            <p style="color: #666; font-size: 12px;">Este código expira en 2 minutos.</p>
            <p style="color: #666; font-size: 12px;">Si no solicitaste este código, ignora este mensaje.</p>
          </div>
        `,
      });

      if (error) throw error;
      this.logger.log('Correo de activación enviado');
    } catch (err: any) {
      console.error('Error enviando correo de activación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de activación');
    }
  }

  async sendPasswordResetEmail(correo: string, resetLink: string, expiresInMinutes: number = 10): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const fromName = this.configService.get<string>('RESEND_FROM_NAME') || 'Miru Franco Salón Beauty';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://miru-franco.vercel.app';

    if (!apiKey || !fromEmail || !this.resend) {
      throw new Error('Resend no está configurado. Por favor configura RESEND_API_KEY y RESEND_FROM_EMAIL.');
    }

    try {
      const { error } = await this.resend.emails.send({
        to: correo,
        from: `${fromName} <${fromEmail}>`,
        subject: 'Recuperar Contraseña - Miru Franco',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #710014; margin: 0;">Miru Franco Salón Beauty</h2>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #161616; margin-top: 0;">Solicitud de Recuperación de Contraseña</h3>
              <p style="color: #495057; line-height: 1.6;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta. 
                Si fuiste tú, haz clic en el botón de abajo para crear una nueva contraseña.
              </p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" 
                 style="display: inline-block; background-color: #710014; color: white; 
                        padding: 14px 28px; text-decoration: none; border-radius: 6px; 
                        font-weight: bold; font-size: 16px;">
                Restablecer Contraseña
              </a>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; border-left: 4px solid #ffc107; margin: 20px 0;">
              <p style="color: #856404; margin: 0; font-size: 14px;">
                <strong>⚠️ Importante:</strong>
              </p>
              <ul style="color: #856404; margin: 10px 0 0 0; padding-left: 20px; font-size: 14px;">
                <li>Este enlace expira en ${expiresInMinutes} minutos</li>
                <li>Solo puede ser usado una vez</li>
                <li>Si no solicitaste este cambio, ignora este mensaje</li>
              </ul>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
              <p style="color: #6c757d; font-size: 12px; margin: 0;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="color: #6c757d; font-size: 12px; word-break: break-all; margin: 5px 0 0 0;">
                ${resetLink}
              </p>
            </div>

            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;">
              <p style="color: #6c757d; font-size: 12px; margin: 0;">
                Este es un correo automático, por favor no respondas.
              </p>
            </div>
          </div>
        `,
      });

      if (error) throw error;
      this.logger.log('Correo de recuperación de contraseña enviado');
    } catch (err: any) {
      console.error('Error enviando correo de recuperación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de recuperación de contraseña');
    }
  }

  /**
   * Código para cambiar la contraseña desde el perfil. El código solo va en el HTML: nunca en los logs.
   */
  async sendCodigoCambioPasswordEmail(correo: string, codigo: string, vigenciaMinutos: number): Promise<void> {
    await this.enviarCorreoCuenta(
      correo,
      'Código para cambiar tu contraseña - Miru Franco',
      `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">Cambio de contraseña</h2>
            <p>Para cambiar la contraseña de tu cuenta de Miru Franco, ingresa este código:</p>
            <div style="background-color: #f2f1ed; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
              <h1 style="color: #161616; font-size: 32px; letter-spacing: 8px; margin: 0;">${codigo}</h1>
            </div>
            <p style="color: #666; font-size: 12px;">Este código vence en ${vigenciaMinutos} minutos y solo sirve una vez.</p>
            <p style="color: #666; font-size: 12px;">Si no fuiste tú, ignora este correo y cambia tu contraseña.</p>
          </div>
        `,
      'código de cambio de contraseña',
    );
  }

  /** Aviso después de cambiar la contraseña: fecha y hora, y cómo recuperar la cuenta. Sin datos sensibles. */
  async sendAvisoPasswordCambiadaEmail(correo: string, fechaHora: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://miru-franco.vercel.app';
    const recuperar = `${frontendUrl}/forgot-password`;
    await this.enviarCorreoCuenta(
      correo,
      'Tu contraseña cambió - Miru Franco',
      `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">Tu contraseña cambió</h2>
            <p>La contraseña de tu cuenta de Miru Franco se cambió el ${escaparHtml(fechaHora)} (hora del centro de México).</p>
            <p>Por seguridad cerramos todas tus sesiones: inicia sesión de nuevo con tu nueva contraseña.</p>
            <p style="color: #666;">Si no fuiste tú, recupera tu cuenta ahora desde <a href="${recuperar}" style="color: #710014;">¿Olvidaste tu contraseña?</a> y elige una contraseña nueva.</p>
          </div>
        `,
      'aviso de cambio de contraseña',
    );
  }

  /** Envío de los correos de la cuenta: el log de error no lleva destinatario ni contenido. */
  private async enviarCorreoCuenta(to: string, subject: string, html: string, tipo: string): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const fromName = this.configService.get<string>('RESEND_FROM_NAME') || 'Miru Franco Salón Beauty';

    if (!apiKey || !fromEmail || !this.resend) {
      throw new Error('Resend no está configurado. Por favor configura RESEND_API_KEY y RESEND_FROM_EMAIL.');
    }

    try {
      const { error } = await this.resend.emails.send({ to, from: `${fromName} <${fromEmail}>`, subject, html });
      if (error) throw error;
      this.logger.log(`Correo enviado: ${tipo}`);
    } catch (err: any) {
      this.logger.error(`Error enviando correo (${tipo}): ${err?.name ?? 'Error'}`);
      throw new Error(`No se pudo enviar el correo (${tipo})`);
    }
  }

  /**
   * Envío genérico para el canal `email` del motor de notificaciones (Etapa 3):
   * a diferencia de los dos métodos de arriba, no trae plantilla propia — el
   * HTML ya viene armado (ver `EmailDispatcher`). Mismo cliente/remitente
   * (`RESEND_API_KEY`/`RESEND_FROM_*`) y mismo criterio de error que los otros
   * dos: loguear el detalle y relanzar un Error fijo en español.
   */
  async sendNotificationEmail(to: string, subject: string, html: string): Promise<void> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const fromName = this.configService.get<string>('RESEND_FROM_NAME') || 'Miru Franco Salón Beauty';

    if (!apiKey || !fromEmail || !this.resend) {
      throw new Error('Resend no está configurado. Por favor configura RESEND_API_KEY y RESEND_FROM_EMAIL.');
    }

    try {
      const { error } = await this.resend.emails.send({
        to,
        from: `${fromName} <${fromEmail}>`,
        subject,
        html,
      });

      if (error) throw error;
      this.logger.log('Correo de notificación enviado');
    } catch (err: any) {
      console.error('Error enviando correo de notificación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de notificación');
    }
  }
}

