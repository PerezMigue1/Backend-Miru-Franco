import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

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
}

