import { EVENTO_ARCO_RESPONDIDA, EVENTO_ARCO_SOLICITUD_CREADA } from '../notificaciones/eventos';
import { ArcoService } from './arco.service';

/**
 * Avisos en vivo de ARCO: la solicitud nueva llega a los admin y la respuesta a la titular (campana y navegador).
 * El evento sale después de guardar y nunca lleva el texto de la respuesta ni datos personales.
 */
const CONTEXTO = { ip: '10.0.0.7', userAgent: 'Navegador del salon' };
const AHORA = new Date('2026-10-14T18:00:00.000Z');

function montar(actual?: Record<string, unknown>) {
  const tx = { solicitudArco: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const prisma: any = {
    solicitudArco: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(actual ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 12, folio: 'ARCO-2026-000012', estado: 'recibida', ...data })),
    },
    usuario: { findUnique: jest.fn().mockResolvedValue({ email: 'ana@example.com' }) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const correo: any = { sendRespuestaArcoEmail: jest.fn().mockResolvedValue(undefined) };
  const eventos = { emit: jest.fn() };
  const servicio = new ArcoService(prisma, correo, eventos as any);
  return { servicio, eventos };
}

describe('ARCO: avisos en vivo', () => {
  it('al crear la solicitud avisa a los admin con folio y tipo', async () => {
    const { servicio, eventos } = montar();
    await servicio.crearSolicitud('u-1', { tipo: 'acceso', descripcion: 'Quiero mis datos' } as any, AHORA);
    expect(eventos.emit).toHaveBeenCalledWith(EVENTO_ARCO_SOLICITUD_CREADA, { solicitudId: 12, folio: 'ARCO-2026-000012', tipo: 'acceso' });
  });

  it('al responder avisa a la titular con folio y estado, sin el texto de la respuesta', async () => {
    const { servicio, eventos } = montar({ id: 12, folio: 'ARCO-2026-000012', tipo: 'acceso', estado: 'en_proceso', usuarioId: 'u-1', respuesta: null, respondidaEn: null, venceEfectividad: null });
    await servicio.actualizarAdmin(12, { estado: 'respondida', respuesta: 'Te enviamos tus datos' } as any, 'admin-1', CONTEXTO, AHORA);
    expect(eventos.emit).toHaveBeenCalledWith(EVENTO_ARCO_RESPONDIDA, { solicitudId: 12, usuarioId: 'u-1', folio: 'ARCO-2026-000012', estado: 'respondida' });
  });

  it('pasar a en proceso no avisa a la titular', async () => {
    const { servicio, eventos } = montar({ id: 12, folio: 'ARCO-2026-000012', tipo: 'acceso', estado: 'recibida', usuarioId: 'u-1', respuesta: null, respondidaEn: null, venceEfectividad: null });
    await servicio.actualizarAdmin(12, { estado: 'en_proceso' } as any, 'admin-1', CONTEXTO, AHORA);
    expect(eventos.emit).not.toHaveBeenCalled();
  });

  it('sin emisor de eventos (pruebas antiguas) sigue funcionando', async () => {
    const prisma: any = {
      solicitudArco: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async () => ({ id: 1, folio: 'F' })) },
    };
    await expect(new ArcoService(prisma, {} as any).crearSolicitud('u-1', { tipo: 'acceso' } as any, AHORA)).resolves.toMatchObject({ success: true });
  });
});
