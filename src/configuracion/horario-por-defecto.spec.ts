import { ConfiguracionService } from './configuracion.service';
import { HorasExtraService } from '../horas-extra/horas-extra.service';

/**
 * Si la fila de configuracion_salon no existiera, se recrea con el horario real del salón:
 * lunes a viernes de 9:30 a 19:30 y sábado de 9:30 a 19:00 (domingo cerrado).
 */
const HORARIO_REAL = {
  entradaLunesViernes: '09:30',
  salidaLunesViernes: '19:30',
  entradaSabado: '09:30',
  salidaSabado: '19:00',
};

function prismaConUpsert() {
  const config = { id: 1, ...HORARIO_REAL, entradaDomingo: null, salidaDomingo: null, tarifaHoraExtra: 0, margenGraciaMinutos: 15 };
  return {
    configuracionSalon: { upsert: jest.fn().mockResolvedValue(config) },
    registroAsistencia: { findMany: jest.fn().mockResolvedValue([]) },
    usuario: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('horario por defecto de configuracion_salon', () => {
  it('ConfiguracionService recrea la fila con el horario real', async () => {
    const prisma = prismaConUpsert();
    await new ConfiguracionService(prisma as any).obtener();
    expect(prisma.configuracionSalon.upsert.mock.calls[0][0].create).toMatchObject(HORARIO_REAL);
  });

  it('HorasExtraService recrea la fila con el mismo horario real', async () => {
    const prisma = prismaConUpsert();
    const servicio = new HorasExtraService(prisma as any);
    await (servicio as any).calcularParaUsuarios('2026-10').catch(() => undefined);
    expect(prisma.configuracionSalon.upsert.mock.calls[0][0].create).toMatchObject(HORARIO_REAL);
  });
});
