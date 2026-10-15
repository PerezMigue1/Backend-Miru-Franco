import { EmailService } from './email.service';

/**
 * Los correos toman de Configuración del sitio el nombre del salón (asunto, remitente y cuerpo) y llevan un pie con
 * su contacto; ya no queda "Miru Franco" escrito a mano ni la URL vieja de respaldo. Resend va simulado.
 */
const config = (extra: Record<string, string> = {}) => ({
  get: (k: string) => ({ RESEND_API_KEY: 'clave-falsa', RESEND_FROM_EMAIL: 'no-responder@example.com', ...extra })[k],
});
const configuracionSitio = {
  publica: jest.fn(async () => ({
    salon: {
      nombre: 'Salón de Prueba & Co',
      direccion: 'Calle Uno No. 1',
      ciudad: 'Huejutla de Reyes, Hidalgo',
      telefono: '+52 771 000 0001',
      whatsapp: '+52 771 000 0002',
      correoContacto: 'contacto@example.com',
    },
  })),
};

function servicio(send: jest.Mock, extra?: Record<string, string>, sitio: unknown = configuracionSitio) {
  const s = new EmailService(config(extra) as any, sitio as any);
  (s as any).resend = { emails: { send } };
  return s;
}

describe('Correos con los datos de Configuración del sitio', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['código de activación', (s: EmailService) => s.sendOTPEmail('a@example.com', '123456')],
    ['recuperar contraseña', (s: EmailService) => s.sendPasswordResetEmail('a@example.com', 'https://www.mirufranco.com/reset?t=x')],
    ['código de cambio de correo', (s: EmailService) => s.sendCodigoCambioCorreoEmail('a@example.com', '123456', 15)],
    ['aviso de correo cambiado', (s: EmailService) => s.sendAvisoCorreoCambiadoEmail('a@example.com', '15 de octubre')],
  ])('%s: el nombre sale de la configuración (escapado en el HTML) y lleva el pie con el contacto', async (_caso, enviar) => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await enviar(servicio(send));
    const { from, subject, html } = send.mock.calls[0][0];
    expect(subject).toContain('Salón de Prueba & Co');
    expect(from).toBe('Salón de Prueba & Co <no-responder@example.com>');
    expect(html).toContain('Salón de Prueba &amp; Co');
    expect(html).not.toMatch(/Miru Franco|\{\{salon\}\}/);
    expect(html).toContain('+52 771 000 0001');
    expect(html).toContain('contacto@example.com');
  });

  it('un nombre guardado con signos de correo o saltos de línea no altera el remitente (una sola dirección, la del salón)', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    const sitio = { publica: jest.fn(async () => ({ salon: { nombre: 'Malo" <x@ejemplo.com>,\r\nBcc: y@ejemplo.com' } })) };
    await servicio(send, undefined, sitio).sendOTPEmail('a@example.com', '123456');
    const { from } = send.mock.calls[0][0];
    expect(from).toMatch(/^[^<>"@,;\r\n]+ <no-responder@example\.com>$/);
  });

  it('RESEND_FROM_NAME, si existe, sigue mandando en el remitente', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send, { RESEND_FROM_NAME: 'Remitente Fijo' }).sendOTPEmail('a@example.com', '123456');
    expect(send.mock.calls[0][0].from).toBe('Remitente Fijo <no-responder@example.com>');
  });

  it('sin la configuración (o si falla) usa el nombre registrado del salón y no rompe el envío', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send, undefined, { publica: jest.fn(async () => { throw new Error('sin base'); }) }).sendOTPEmail('a@example.com', '123456');
    const { subject, html } = send.mock.calls[0][0];
    expect(subject).toContain('Mirú Franco Salón Beauty');
    expect(html).not.toContain('{{salon}}');
  });

  it('el enlace de recuperación del aviso de contraseña ya no cae a miru-franco.vercel.app sin FRONTEND_URL', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendAvisoPasswordCambiadaEmail('a@example.com', '15 de octubre');
    const { html } = send.mock.calls[0][0];
    expect(html).not.toContain('vercel.app');
    expect(html).toContain('https://www.mirufranco.com/forgot-password');
  });
});

describe('Sin el dominio viejo como respaldo', () => {
  it('ningún archivo del backend cae a miru-franco.vercel.app (los enlaces salen de FRONTEND_URL o del dominio real)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync, readFileSync, statSync } = require('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path');
    const raiz = join(__dirname, '..');
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) archivos.push(p);
      }
    };
    recorrer(raiz);
    const conDominioViejo = archivos.filter((p) => readFileSync(p, 'utf8').includes('miru-franco.vercel.app'));
    expect(conDominioViejo.map((p) => p.slice(raiz.length + 1))).toEqual([]);
  });
});
