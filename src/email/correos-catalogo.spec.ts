import { EmailService } from './email.service';
import { EmailDispatcher } from '../notificaciones/dispatchers/email.dispatcher';
import { establecerTextosSitio } from '../textos-sitio/textos-sitio.util';
import { correoPreguntaCambiada } from './plantillas-correo';

/**
 * Asunto y cuerpo de los correos salen del catálogo de Textos del sitio (con sus variables); el diseño se queda en el
 * código. El encabezado y el nombre del salón salen de Configuración del sitio. Resend va simulado.
 */
const config = { get: (k: string) => ({ RESEND_API_KEY: 'clave-falsa', RESEND_FROM_EMAIL: 'no-responder@example.com' })[k] };
const sitio = { publica: jest.fn(async () => ({ salon: { nombre: 'Salón Nuevo <Uno>', telefono: '+52 771 000 0001' } })) };

function servicio(send: jest.Mock) {
  const s = new EmailService(config as any, sitio as any);
  (s as any).resend = { emails: { send } };
  return s;
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => {
  establecerTextosSitio([]);
  jest.restoreAllMocks();
});

describe('Correos con los textos del catálogo', () => {
  it('lo que guarda la dueña cambia asunto y cuerpo, con sus variables llenas y escapadas', async () => {
    establecerTextosSitio([
      { clave: 'correos.codigoPassword.asunto', valor: 'Tu código de {nombreSalon}' },
      { clave: 'correos.codigoPassword.nota', valor: 'Vence en {minutos} minutos.\n\nSi no fuiste tú, avísanos & cambia tu contraseña.' },
    ]);
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendCodigoCambioPasswordEmail('a@example.com', '482913', 12);
    const { subject, html } = send.mock.calls[0][0];
    expect(subject).toBe('Tu código de Salón Nuevo <Uno>');
    expect(html).toContain('Vence en 12 minutos.');
    expect(html).toContain('avísanos &amp; cambia');
    expect(html).toContain('482913');
    expect(html).not.toContain('<Uno>');
    expect(html).toContain('Salón Nuevo &lt;Uno&gt;');
  });

  it('sin cambios, el texto es el de hoy', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendAvisoCorreoCambiadoEmail('a@example.com', '15 de octubre');
    const { subject, html } = send.mock.calls[0][0];
    expect(subject).toBe('Tu correo cambió - Salón Nuevo <Uno>');
    expect(html).toContain('se cambió el 15 de octubre (hora del centro de México)');
  });

  it('el enlace de recuperar la cuenta sigue siendo un enlace aunque el texto venga del catálogo', async () => {
    establecerTextosSitio([{ clave: 'correos.passwordCambiada.textoEnlace', valor: 'Recuperar mi cuenta' }]);
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendAvisoPasswordCambiadaEmail('a@example.com', '7 de octubre');
    const { html } = send.mock.calls[0][0];
    expect(html).toMatch(/<a href="https:\/\/www\.mirufranco\.com\/forgot-password"[^>]*>Recuperar mi cuenta<\/a>/);
    expect(html).not.toContain('[[enlaceRecuperar]]');
  });

  it('la pregunta de seguridad ya no lleva "Miru Franco" fijo: el salón es el de la configuración', async () => {
    const { asunto, html } = correoPreguntaCambiada('16 de octubre');
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendNotificationEmail('a@example.com', asunto, html);
    const enviado = send.mock.calls[0][0];
    expect(enviado.subject).toBe('Tu pregunta de seguridad cambió - Salón Nuevo <Uno>');
    expect(enviado.html).toContain('tu cuenta de Salón Nuevo &lt;Uno&gt; se cambió el 16 de octubre');
    expect(enviado.html).not.toMatch(/Miru Franco|\{\{salon\}\}/);
  });
});

describe('Correo de los avisos internos', () => {
  it('el encabezado lleva el nombre del salón de la configuración y el pie sale del catálogo', async () => {
    establecerTextosSitio([{ clave: 'correos.pieAutomatico', valor: 'Correo automático del salón.' }]);
    const send = jest.fn().mockResolvedValue({ error: null });
    const email = servicio(send);
    const prisma = { usuario: { findUnique: jest.fn(async () => ({ email: 'c@example.com' })) }, notificacionEnvio: { update: jest.fn(async () => ({})) } };
    await new EmailDispatcher(prisma as any, email).enviar({ id: 'e1', notificacion: { usuarioId: 'u', titulo: 'Pedido cancelado', mensaje: 'Tu pedido #9 fue cancelado' } } as any);
    const { subject, html } = send.mock.calls[0][0];
    expect(subject).toBe('Pedido cancelado');
    expect(html).toContain('<h2 style="color: #710014; margin: 0;">Salón Nuevo &lt;Uno&gt;</h2>');
    expect(html).toContain('Correo automático del salón.');
    expect(html).not.toContain('Miru Franco');
  });
});
