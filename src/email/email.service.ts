import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

@Injectable()
export class EmailService {
  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    if (apiKey) {
      sgMail.setApiKey(apiKey);
    } else {
      console.warn('⚠️ SENDGRID_API_KEY no configurada. Los emails no se enviarán.');
    }
  }

  async sendOTPEmail(correo: string, codigoOTP: string): Promise<void> {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const fromEmail = this.configService.get<string>('SENDGRID_FROM_EMAIL');
    const fromName = this.configService.get<string>('SENDGRID_FROM_NAME') || 'Miru Franco Salón Beauty';

    if (!apiKey || !fromEmail) {
      throw new Error('SendGrid no está configurado. Por favor configura SENDGRID_API_KEY y SENDGRID_FROM_EMAIL.');
    }

    try {
      const msg = {
        to: correo,
        from: {
          name: fromName,
          email: fromEmail,
        },
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
      };

      await sgMail.send(msg);
      console.log('Correo de activación enviado a:', correo);
    } catch (err: any) {
      console.error('Error enviando correo de activación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de activación');
    }
  }

  async sendPasswordResetEmail(correo: string, resetLink: string, expiresInMinutes: number = 60): Promise<void> {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const fromEmail = this.configService.get<string>('SENDGRID_FROM_EMAIL');
    const fromName = this.configService.get<string>('SENDGRID_FROM_NAME') || 'Miru Franco Salón Beauty';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://miru-franco.vercel.app';

    if (!apiKey || !fromEmail) {
      throw new Error('SendGrid no está configurado. Por favor configura SENDGRID_API_KEY y SENDGRID_FROM_EMAIL.');
    }

    try {
      const msg = {
        to: correo,
        from: {
          name: fromName,
          email: fromEmail,
        },
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
      };

      await sgMail.send(msg);
      console.log('Correo de recuperación de contraseña enviado a:', correo);
    } catch (err: any) {
      console.error('Error enviando correo de recuperación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de recuperación de contraseña');
    }
  }
}

