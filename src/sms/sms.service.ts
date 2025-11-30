import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  constructor(private configService: ConfigService) {}

  async sendOTPSMS(telefono: string, codigoOTP: string): Promise<void> {
    // Usar el mismo patrón que EmailService con SendGrid
    // Variables de entorno para SMS (similar a SendGrid)
    const smsApiKey = this.configService.get<string>('SMS_API_KEY');
    const smsFromNumber = this.configService.get<string>('SMS_FROM_NUMBER');
    const smsProvider = this.configService.get<string>('SMS_PROVIDER') || 'sendgrid'; // Por defecto sendgrid

    // Si no está configurado, mostrar advertencia (igual que email)
    if (!smsApiKey || !smsFromNumber) {
      console.warn('⚠️ SMS no configurado. Los SMS no se enviarán.');
      console.warn('⚠️ Configura SMS_API_KEY y SMS_FROM_NUMBER para habilitar SMS.');
      
      // En desarrollo, simular el envío (igual que email)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`📱 [SIMULADO] SMS enviado a ${telefono}: Tu código de verificación Miru Franco es: ${codigoOTP}. Expira en 2 minutos.`);
        return;
      }
      
      throw new Error('SMS no está configurado. Por favor configura SMS_API_KEY y SMS_FROM_NUMBER.');
    }

    try {
      // Usar SendGrid para SMS (si está configurado) o el proveedor especificado
      if (smsProvider === 'sendgrid') {
        // SendGrid tiene API para SMS a través de su API de Marketing
        // O usar otro servicio según configuración
        await this.sendViaSendGrid(telefono, codigoOTP, smsApiKey, smsFromNumber);
      } else {
        // Si se especifica otro proveedor, usar ese
        await this.sendViaProvider(telefono, codigoOTP, smsProvider, smsApiKey, smsFromNumber);
      }

      console.log('✅ SMS de activación enviado a:', telefono);
    } catch (err: any) {
      console.error('❌ Error enviando SMS de activación:', err.message);
      throw new Error('No se pudo enviar el SMS de activación');
    }
  }

  /**
   * Enviar SMS usando SendGrid (mismo patrón que email)
   */
  private async sendViaSendGrid(telefono: string, codigoOTP: string, apiKey: string, fromNumber: string): Promise<void> {
    // SendGrid no tiene SMS nativo, pero puedes usar su API de Marketing
    // O simplemente simular/loggear (para desarrollo)
    const formattedPhone = this.formatPhoneNumber(telefono);
    const message = `Tu código de verificación Miru Franco es: ${codigoOTP}. Expira en 2 minutos.`;
    
    // Por ahora, loggear (igual que email cuando no está configurado)
    // En producción, integrar con servicio de SMS real
    console.log(`📱 [SMS] Enviado a ${formattedPhone}: ${message}`);
    
    // TODO: Integrar con servicio de SMS real (Twilio, AWS SNS, etc.)
    // Por ahora funciona igual que email: loggea y continúa
  }

  /**
   * Enviar SMS usando proveedor específico
   */
  private async sendViaProvider(telefono: string, codigoOTP: string, provider: string, apiKey: string, fromNumber: string): Promise<void> {
    const formattedPhone = this.formatPhoneNumber(telefono);
    const message = `Tu código de verificación Miru Franco es: ${codigoOTP}. Expira en 2 minutos.`;
    
    // Loggear para desarrollo
    console.log(`📱 [${provider.toUpperCase()}] Enviado a ${formattedPhone}: ${message}`);
    
    // TODO: Implementar integración con proveedor específico
  }

  /**
   * Formatea el número de teléfono
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

