import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

/** Correo con el código para cambiar el correo de la cuenta: Resend va simulado (no sale ningún correo). */
describe('Correo del código de cambio de correo', () => {
  const CORREO_NUEVO = 'nuevo.correo@example.com';
  const config = {
    get: (k: string) => ({ RESEND_API_KEY: 'clave-falsa', RESEND_FROM_EMAIL: 'no-responder@example.com' })[k],
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

  it('va al correo nuevo, en español, con el código y la vigencia; el log no lleva el código ni el correo', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendCodigoCambioCorreoEmail(CORREO_NUEVO, '004821', 15);
    const [{ to, subject, html }] = send.mock.calls[0];
    expect(to).toBe(CORREO_NUEVO);
    expect(subject).toMatch(/correo/i);
    expect(html).toContain('004821');
    expect(html).toContain('15 minutos');
    expect(html).toMatch(/Si no fuiste tú/);
    expect(salidas.join('\n')).not.toContain('004821');
    expect(salidas.join('\n')).not.toContain(CORREO_NUEVO);
  });

  it('si Resend falla lanza un error fijo y el log no lleva el código ni el correo', async () => {
    const send = jest.fn().mockResolvedValue({ error: { message: 'fallo simulado' } });
    await expect(servicio(send).sendCodigoCambioCorreoEmail(CORREO_NUEVO, '004821', 15)).rejects.toThrow('No se pudo enviar');
    expect(salidas.join('\n')).not.toContain('004821');
    expect(salidas.join('\n')).not.toContain(CORREO_NUEVO);
  });

  describe('aviso al correo anterior', () => {
    const CORREO_ANTERIOR = 'anterior@example.com';
    const FECHA = '14 de octubre de 2026, 15:30';

    it('va al correo anterior, en español, con fecha y hora y qué hacer si no fue ella; el log no lleva el correo', async () => {
      const send = jest.fn().mockResolvedValue({ error: null });
      await servicio(send).sendAvisoCorreoCambiadoEmail(CORREO_ANTERIOR, FECHA);
      expect(send).toHaveBeenCalledTimes(1);
      const [{ to, subject, html }] = send.mock.calls[0];
      expect(to).toBe(CORREO_ANTERIOR);
      expect(subject).toBe('Tu correo cambió - Mirú Franco Salón Beauty');
      expect(html).toContain(FECHA);
      expect(html).toContain('hora del centro de México');
      expect(html).toMatch(/Si no fuiste tú/);
      expect(salidas.join('\n')).not.toContain(CORREO_ANTERIOR);
    });

    it('escapa la fecha (HTML) y si Resend falla lanza un error fijo sin el correo en el log', async () => {
      const ok = jest.fn().mockResolvedValue({ error: null });
      await servicio(ok).sendAvisoCorreoCambiadoEmail(CORREO_ANTERIOR, '<b>hoy</b>');
      expect(ok.mock.calls[0][0].html).not.toContain('<b>hoy</b>');
      const falla = jest.fn().mockResolvedValue({ error: { message: 'fallo simulado' } });
      await expect(servicio(falla).sendAvisoCorreoCambiadoEmail(CORREO_ANTERIOR, FECHA)).rejects.toThrow('No se pudo enviar');
      expect(salidas.join('\n')).not.toContain(CORREO_ANTERIOR);
    });
  });
});
