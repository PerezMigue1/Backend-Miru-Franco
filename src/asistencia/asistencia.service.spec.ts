import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AsistenciaService } from './asistencia.service';

/** Corrección de asistencia: nadie corrige su propio registro (salvo admin) y la salida no pasa del día. */
const REGISTRO = { id: 7, usuarioId: 'est-1', fecha: '2026-10-10', horaEntrada: new Date('2026-10-10T10:00:00-06:00'), horaSalida: null };

function servicio() {
  const prisma: any = {
    registroAsistencia: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === REGISTRO.id ? { ...REGISTRO } : null)),
      update: jest.fn(async ({ data }: any) => ({ ...REGISTRO, ...data })),
    },
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  return { s: new AsistenciaService(prisma), prisma };
}

describe('AsistenciaService.corregir', () => {
  it('la estilista no corrige su propio registro: 403 y no se escribe', async () => {
    const { s, prisma } = servicio();
    await expect(
      s.corregir(7, 'est-1', { horaSalida: '2026-10-10T19:00:00-06:00' }, 'estilista'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.registroAsistencia.update).not.toHaveBeenCalled();
  });

  it('el admin sí corrige el suyo, y la estilista el de otra persona', async () => {
    const { s } = servicio();
    await expect(s.corregir(7, 'est-1', { horaSalida: '2026-10-10T19:00:00-06:00' }, 'admin')).resolves.toMatchObject({ success: true });
    await expect(s.corregir(7, 'est-2', { horaSalida: '2026-10-10T19:00:00-06:00' }, 'estilista')).resolves.toMatchObject({ success: true });
  });

  it('la salida corregida no pasa del final del día del registro (hora de México): 400', async () => {
    const { s, prisma } = servicio();
    const e = await s.corregir(7, 'est-2', { horaSalida: '2026-10-11T00:30:00-06:00' }, 'estilista').catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toBe('La hora de salida no puede pasar del final del día del registro');
    expect(prisma.registroAsistencia.update).not.toHaveBeenCalled();
    // 23:59 del mismo día en México (05:59 UTC del día siguiente) sí se acepta
    await expect(s.corregir(7, 'est-2', { horaSalida: '2026-10-11T05:59:00Z' }, 'estilista')).resolves.toMatchObject({ success: true });
  });
});
