import { Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';

/** Correos de ARCO a la titular (respuesta y confirmación de la cancelación): Resend va simulado, no sale ningún correo. */
describe('Correos de ARCO', () => {
  const CORREO = 'ana.titular@example.com';
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
    const capturar = (...a: unknown[]) => {
      salidas.push(a.map(String).join(' '));
    };
    for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(capturar);
    for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capturar as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('respuesta: va a la titular con el folio, el tipo, el estado y la respuesta (escapada); el log no lleva el correo ni la respuesta', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendRespuestaArcoEmail(CORREO, {
      folio: 'ARCO-2026-000004',
      tipo: 'rectificacion',
      estado: 'respondida',
      respuesta: 'Corregimos tu teléfono <b>hoy</b>.',
    });
    const [{ to, subject, html }] = send.mock.calls[0];
    expect(to).toBe(CORREO);
    expect(subject).toContain('ARCO-2026-000004');
    expect(html).toContain('ARCO-2026-000004');
    expect(html).toContain('Rectificación');
    expect(html).toContain('Respondida');
    expect(html).toContain('Corregimos tu teléfono &lt;b&gt;hoy&lt;/b&gt;.');
    expect(html).not.toContain('<b>hoy</b>');
    const log = salidas.join('\n');
    expect(log).not.toContain(CORREO);
    expect(log).not.toContain('Corregimos');
  });

  it.each([
    ['atendida', 'Atendida'],
    ['rechazada', 'Rechazada'],
  ])('respuesta con estado %s: el estado en español', async (estado, etiqueta) => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendRespuestaArcoEmail(CORREO, { folio: 'ARCO-2026-000005', tipo: 'revocacion', estado, respuesta: 'Listo' });
    expect(send.mock.calls[0][0].html).toContain(etiqueta);
    expect(send.mock.calls[0][0].html).toContain('Revocación del consentimiento');
  });

  it('cancelación: confirma al correo original con folio, fecha y lo que se conserva por ley', async () => {
    const send = jest.fn().mockResolvedValue({ error: null });
    await servicio(send).sendCancelacionCuentaArcoEmail(CORREO, { folio: 'ARCO-2026-000007', fecha: new Date('2026-10-14T18:00:00.000Z') });
    const [{ to, subject, html }] = send.mock.calls[0];
    expect(to).toBe(CORREO);
    expect(subject).toMatch(/cancel/i);
    expect(html).toContain('ARCO-2026-000007');
    expect(html).toContain('14 de octubre de 2026');
    for (const conservado of ['pedidos', 'pagos', 'facturas', 'ventas', 'citas', 'quejas', 'valoraciones', 'consentimientos', 'solicitudes ARCO']) {
      expect(html).toContain(conservado);
    }
    expect(salidas.join('\n')).not.toContain(CORREO);
  });

  it('si Resend falla lanza un error fijo y el log no lleva el correo', async () => {
    const send = jest.fn().mockResolvedValue({ error: { message: `rebote de ${CORREO}` } });
    await expect(
      servicio(send).sendRespuestaArcoEmail(CORREO, { folio: 'ARCO-2026-000004', tipo: 'acceso', estado: 'respondida', respuesta: 'Hola' }),
    ).rejects.toThrow('No se pudo enviar');
    await expect(servicio(send).sendCancelacionCuentaArcoEmail(CORREO, { folio: 'ARCO-2026-000007', fecha: new Date() })).rejects.toThrow(
      'No se pudo enviar',
    );
    expect(salidas.join('\n')).not.toContain(CORREO);
  });
});
