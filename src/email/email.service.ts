import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { escaparHtml } from '../common/utils/security.util';
import { ConfiguracionSitioService } from '../configuracion-sitio/configuracion-sitio.service';
import {
  MARCADOR_SALON,
  correoActivacion,
  correoCancelacionCuentaArco,
  correoCodigoCorreo,
  correoCodigoCorreoActual,
  correoCodigoPassword,
  correoCorreoCambiado,
  correoPasswordCambiada,
  correoRecuperarPassword,
  correoRespuestaArco,
  type Correo,
} from './plantillas-correo';

/** Nombre registrado del salón (Términos y Aviso): se usa si la configuración no responde. */
const NOMBRE_SALON_REGISTRADO = 'Mirú Franco Salón Beauty';
/** El nombre en el remitente ("Nombre <correo>"): sin signos de dirección ni saltos de línea, nunca otra dirección. */
const nombreParaRemitente = (nombre: string) => nombre.replace(/[<>"@,;\\\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim() || NOMBRE_SALON_REGISTRADO;

type ParametrosCorreo = { to: string; from: string; subject: string; html: string };

/**
 * Envío de correos con Resend. El asunto y los textos de cada correo salen del catálogo de Textos del sitio
 * (plantillas-correo.ts); el diseño HTML se queda en el código. El nombre del salón sale de Configuración del sitio.
 */
@Injectable()
export class EmailService {
  // Sin destinatario en los logs: el correo de la clienta es dato personal.
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;

  constructor(
    private configService: ConfigService,
    @Optional() private readonly configuracionSitio?: ConfiguracionSitioService,
  ) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      console.warn('⚠️ RESEND_API_KEY no configurada. Los emails no se enviarán.');
    }
  }

  /** Remitente con el marcador del salón (o RESEND_FROM_NAME si existe); null si Resend no está configurado. */
  private remitente(): string | null {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const fromName = this.configService.get<string>('RESEND_FROM_NAME') || MARCADOR_SALON;
    if (!apiKey || !fromEmail || !this.resend) return null;
    return `${fromName} <${fromEmail}>`;
  }

  private noConfigurado(): Error {
    return new Error('Resend no está configurado. Por favor configura RESEND_API_KEY y RESEND_FROM_EMAIL.');
  }

  async sendOTPEmail(correo: string, codigoOTP: string): Promise<void> {
    const from = this.remitente();
    if (!from) throw this.noConfigurado();
    try {
      const { asunto, html } = correoActivacion(codigoOTP);
      const { error } = await this.enviarConMarca({ to: correo, from, subject: asunto, html });
      if (error) throw error;
      this.logger.log('Correo de activación enviado');
    } catch (err: any) {
      console.error('Error enviando correo de activación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de activación');
    }
  }

  async sendPasswordResetEmail(correo: string, resetLink: string, expiresInMinutes: number = 10): Promise<void> {
    const from = this.remitente();
    if (!from) throw this.noConfigurado();
    try {
      const { asunto, html } = correoRecuperarPassword(resetLink, expiresInMinutes);
      const { error } = await this.enviarConMarca({ to: correo, from, subject: asunto, html });
      if (error) throw error;
      this.logger.log('Correo de recuperación de contraseña enviado');
    } catch (err: any) {
      console.error('Error enviando correo de recuperación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de recuperación de contraseña');
    }
  }

  /** Código para cambiar la contraseña desde el perfil. El código solo va en el HTML: nunca en los logs. */
  async sendCodigoCambioPasswordEmail(correo: string, codigo: string, vigenciaMinutos: number): Promise<void> {
    await this.enviarCorreoCuenta(correo, correoCodigoPassword(codigo, vigenciaMinutos), 'código de cambio de contraseña');
  }

  /** Código para confirmar el correo nuevo de la cuenta (se envía al correo nuevo). El código nunca va en los logs. */
  async sendCodigoCambioCorreoEmail(correoNuevo: string, codigo: string, vigenciaMinutos: number): Promise<void> {
    await this.enviarCorreoCuenta(correoNuevo, correoCodigoCorreo(codigo, vigenciaMinutos), 'código de cambio de correo');
  }

  /**
   * Cuenta sin contraseña (solo Google): código al correo ACTUAL para confirmar que la titular pide el cambio. Dice
   * a qué correo se quiere cambiar, para que lo reconozca o lo ignore.
   */
  async sendCodigoCorreoActualEmail(correoActual: string, codigo: string, correoNuevo: string, vigenciaMinutos: number): Promise<void> {
    await this.enviarCorreoCuenta(correoActual, correoCodigoCorreoActual(codigo, correoNuevo, vigenciaMinutos), 'código de cambio de correo al correo actual');
  }

  /** Aviso después de cambiar la contraseña: fecha y hora, y cómo recuperar la cuenta. Sin datos sensibles. */
  async sendAvisoPasswordCambiadaEmail(correo: string, fechaHora: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://www.mirufranco.com';
    await this.enviarCorreoCuenta(correo, correoPasswordCambiada(fechaHora, `${frontendUrl}/forgot-password`), 'aviso de cambio de contraseña');
  }

  /** Envío de los correos de la cuenta: el log de error no lleva destinatario ni contenido. */
  private async enviarCorreoCuenta(to: string, correo: Correo, tipo: string): Promise<void> {
    const from = this.remitente();
    if (!from) throw this.noConfigurado();
    try {
      const { error } = await this.enviarConMarca({ to, from, subject: correo.asunto, html: correo.html });
      if (error) throw error;
      this.logger.log(`Correo enviado: ${tipo}`);
    } catch (err: any) {
      this.logger.error(`Error enviando correo (${tipo}): ${err?.name ?? 'Error'}`);
      throw new Error(`No se pudo enviar el correo (${tipo})`);
    }
  }

  /**
   * Envío genérico para el canal `email` del motor de notificaciones: el HTML ya viene armado (EmailDispatcher con
   * htmlAviso, o el aviso de pregunta de seguridad). Mismo remitente y mismo criterio de error que los demás.
   */
  async sendNotificationEmail(to: string, subject: string, html: string): Promise<void> {
    const from = this.remitente();
    if (!from) throw this.noConfigurado();
    try {
      const { error } = await this.enviarConMarca({ to, from, subject, html });
      if (error) throw error;
      this.logger.log('Correo de notificación enviado');
    } catch (err: any) {
      console.error('Error enviando correo de notificación:', err.response?.body || err.message);
      throw new Error('No se pudo enviar el correo de notificación');
    }
  }

  /**
   * ARCO: aviso a la titular cuando el salón responde, atiende o rechaza su solicitud (folio, tipo, estado y la
   * respuesta). El log no lleva destinatario ni contenido (ver enviarCorreoCuenta).
   */
  async sendRespuestaArcoEmail(correo: string, datos: { folio: string; tipo: string; estado: string; respuesta: string }): Promise<void> {
    await this.enviarCorreoCuenta(correo, correoRespuestaArco(datos), 'respuesta ARCO');
  }

  /**
   * ARCO: confirmación de la cancelación de la cuenta. Se manda al correo que la titular tenía ANTES de anonimizarla
   * (después de anonimizar la cuenta ya no tiene correo). Nombra lo que se conserva por obligación legal.
   */
  async sendCancelacionCuentaArcoEmail(correo: string, datos: { folio: string; fecha: Date }): Promise<void> {
    await this.enviarCorreoCuenta(correo, correoCancelacionCuentaArco(datos), 'cancelación ARCO');
  }

  /** Cambio de correo de la cuenta: aviso al correo ANTERIOR con la fecha y hora. No lleva el correo nuevo. */
  async sendAvisoCorreoCambiadoEmail(correoAnterior: string, fechaHora: string): Promise<void> {
    await this.enviarCorreoCuenta(correoAnterior, correoCorreoCambiado(fechaHora), 'aviso de cambio de correo');
  }

  /** Nombre y contacto del salón desde Configuración del sitio (con caché); sin ella, el nombre registrado. */
  private async datosSalon(): Promise<{ nombre: string; pie: string }> {
    try {
      const salon = ((await this.configuracionSitio?.publica()) as { salon?: Record<string, string> } | undefined)?.salon;
      if (!salon?.nombre) return { nombre: NOMBRE_SALON_REGISTRADO, pie: '' };
      const partes = [
        [salon.direccion, salon.ciudad].filter(Boolean).join(', '),
        salon.telefono ? `Tel. ${salon.telefono}` : '',
        salon.whatsapp ? `WhatsApp ${salon.whatsapp}` : '',
        salon.correoContacto ?? '',
      ].filter(Boolean);
      const pie = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 24px auto 0; padding-top: 12px; border-top: 1px solid #e5e0d8; color: #666; font-size: 12px;"><strong>${escaparHtml(salon.nombre)}</strong><br>${partes.map((p) => escaparHtml(p)).join(' · ')}</div>`;
      return { nombre: salon.nombre, pie };
    } catch {
      return { nombre: NOMBRE_SALON_REGISTRADO, pie: '' };
    }
  }

  /** Todos los correos salen por aquí: nombre del salón de la configuración en remitente, asunto y cuerpo, y pie con el contacto. */
  private async enviarConMarca(p: ParametrosCorreo) {
    const { nombre, pie } = await this.datosSalon();
    const enTexto = (t: string) => t.split(MARCADOR_SALON).join(nombre);
    const enHtml = (t: string) => t.split(MARCADOR_SALON).join(escaparHtml(nombre));
    return this.resend!.emails.send({
      ...p,
      from: p.from.split(MARCADOR_SALON).join(nombreParaRemitente(nombre)),
      subject: enTexto(p.subject),
      html: enHtml(p.html) + pie,
    });
  }
}
