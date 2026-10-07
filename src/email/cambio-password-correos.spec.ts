import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

/** Correos del cambio de contraseña: el envío a Resend va simulado (no sale ningún correo real). */
describe('Correos del cambio de contraseña', () => {
  const CORREO = 'clienta.prueba@example.com';
  const config = {
    get: (k: string) =>
      ({ RESEND_API_KEY: 'clave-falsa', RESEND_FROM_EMAIL: 'no-responder@example.com', FRONTEND_URL: 'https://sitio.example.com' })[k],
  };
  const salidas: string[] = [];

  function servicio(send: jest.Mock) {
    const s = new EmailService(config as any);
    (s as any).resend = { emails: { send } };
    return s;
  }

  beforeEach(() => {
    salidas.length = 0;
    const capturar = (...a: unknown[]) => salidas.push(a.map(String).join(' '));
    for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(capturar);
    for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capturar as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('código: plantilla en español con el código, la vigencia y "Si no fuiste tú…"', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendCodigoCambioPasswordEmail(CORREO, '482913', 10);
    const [{ to, subject, html }] = send.mock.calls[0];
    expect(to).toBe(CORREO);
    expect(subject).toMatch(/contraseña/i);
    expect(html).toContain('482913');
    expect(html).toContain('10 minutos');
    expect(html).toContain('Si no fuiste tú, ignora este correo y cambia tu contraseña');
    expect(salidas.join('\n')).not.toContain('482913');
    expect(salidas.join('\n')).not.toContain(CORREO);
  });

  it('código: si Resend falla lanza un error fijo y el log no lleva el código ni el correo', async () => {
    const send = jest.fn().mockResolvedValue({ error: { message: 'fallo simulado' } });
    await expect(servicio(send).sendCodigoCambioPasswordEmail(CORREO, '482913', 10)).rejects.toThrow('No se pudo enviar');
    expect(salidas.join('\n')).not.toContain('482913');
    expect(salidas.join('\n')).not.toContain(CORREO);
  });

  it('aviso: "Tu contraseña cambió" con fecha y hora, y cómo recuperar la cuenta', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendAvisoPasswordCambiadaEmail(CORREO, '7 de octubre de 2026, 10:15');
    const [{ to, subject, html }] = send.mock.calls[0];
    expect(to).toBe(CORREO);
    expect(subject).toContain('Tu contraseña cambió');
    expect(html).toContain('7 de octubre de 2026, 10:15');
    expect(html).toContain('https://sitio.example.com/forgot-password');
    expect(html).toMatch(/Si no fuiste tú/);
  });
});
