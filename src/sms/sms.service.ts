import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  constructor(private configService: ConfigService) {}

  async sendOTPSMS(telefono: string, codigoOTP: string): Promise<void> {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const fromNumber = this.configService.get<string>('TWILIO_FROM_NUMBER');

    // Si Twilio no está configurado, intentar usar otro servicio o mostrar advertencia
    if (!accountSid || !authToken || !fromNumber) {
      console.warn('⚠️ TWILIO no configurado. Los SMS no se enviarán.');
      console.warn('⚠️ Configura TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM_NUMBER para habilitar SMS.');
      
      // En desarrollo, puedes simular el envío
      if (process.env.NODE_ENV !== 'production') {
        console.log(`📱 [SIMULADO] SMS enviado a ${telefono}: Tu código de verificación Miru Franco es: ${codigoOTP}. Expira en 2 minutos.`);
        return;
      }
      
      throw new Error('Twilio no está configurado. Por favor configura TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM_NUMBER.');
    }

    try {
      // Importar Twilio dinámicamente solo si está configurado
      const twilio = require('twilio');
      const client = twilio(accountSid, authToken);

      const message = await client.messages.create({
        body: `Tu código de verificación Miru Franco es: ${codigoOTP}. Expira en 2 minutos.`,
        from: fromNumber,
        to: this.formatPhoneNumber(telefono),
      });

      console.log('✅ SMS de activación enviado a:', telefono, 'SID:', message.sid);
    } catch (err: any) {
      console.error('❌ Error enviando SMS de activación:', err.message);
      throw new Error('No se pudo enviar el SMS de activación');
    }
  }

  /**
   * Formatea el número de teléfono para Twilio
   * Asegura que tenga el formato correcto (+[código país][número])
   */
  private formatPhoneNumber(telefono: string): string {
    // Remover espacios, guiones y paréntesis
    let formatted = telefono.replace(/[\s\-\(\)]/g, '');

    // Si no empieza con +, agregarlo (asumiendo formato mexicano si no tiene código de país)
    if (!formatted.startsWith('+')) {
      // Si empieza con 52 (México), agregar +
      if (formatted.startsWith('52')) {
        formatted = '+' + formatted;
      } else if (formatted.startsWith('1')) {
        // Si empieza con 1 (USA/Canadá), agregar +
        formatted = '+' + formatted;
      } else if (formatted.length === 10) {
        // Si tiene 10 dígitos, asumir México y agregar +52
        formatted = '+52' + formatted;
      } else {
        // Mantener como está y agregar +
        formatted = '+' + formatted;
      }
    }

    return formatted;
  }
}

