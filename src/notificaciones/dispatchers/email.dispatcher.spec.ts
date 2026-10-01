import { EmailDispatcher } from './email.dispatcher';

describe('EmailDispatcher: datos de la base dentro del HTML del correo', () => {
  it('escapa & < > " y \' del título y del mensaje', async () => {
    const prisma = {
      usuario: { findUnique: jest.fn().mockResolvedValue({ email: 'cliente@example.com' }) },
      notificacionEnvio: { update: jest.fn().mockResolvedValue({}) },
    };
    const emailService = { sendNotificationEmail: jest.fn().mockResolvedValue(undefined) };
    const dispatcher = new EmailDispatcher(prisma as any, emailService as any);

    await dispatcher.enviar({
      id: 1,
      notificacion: {
        usuarioId: 'u-1',
        titulo: "Cita con Ana & O'Brien",
        mensaje: 'Nota: <b>"tinte"</b>',
      },
    } as any);

    const html: string = emailService.sendNotificationEmail.mock.calls[0][2];
    expect(html).toContain('Cita con Ana &amp; O&#x27;Brien');
    expect(html).toContain('Nota: &lt;b&gt;&quot;tinte&quot;&lt;/b&gt;');
    expect(html).not.toContain("O'Brien");
    expect(html).not.toContain('<b>');
  });
});
