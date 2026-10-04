import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { CreateSeguimientoDto } from './dto/create-seguimiento.dto';
import { SeguimientosService } from './seguimientos.service';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const BASE = { usuarioId: '11111111-1111-4111-8111-111111111111', notas: 'Le gustó el resultado', fechaContacto: '2026-10-04T15:00:00.000Z', requiereAccion: false };

function servicioCon(citas: { id: number; clienteId?: string | null }[]) {
  const create = jest.fn(async ({ data }: any) => ({ id: 1, ...data }));
  const prisma: any = {
    usuario: { findUnique: jest.fn(async () => ({ id: BASE.usuarioId })) },
    cita: { findUnique: jest.fn(async ({ where }: any) => citas.find((c) => c.id === where.id) ?? null) },
    seguimientoPostServicio: { create },
  };
  return { servicio: new SeguimientosService(prisma), create };
}

describe('POST /seguimientos con citaId opcional', () => {
  it('el DTO acepta citaId (antes respondía 400) y lo convierte a número', async () => {
    const dto = await pipe.transform({ ...BASE, citaId: '42' }, { type: 'body', metatype: CreateSeguimientoDto });
    expect(dto.citaId).toBe(42);
  });

  it('guarda el seguimiento ligado a la cita cuando la cita existe', async () => {
    const { servicio, create } = servicioCon([{ id: 42 }]);
    await servicio.crear({ ...BASE, citaId: 42 } as any);
    expect(create.mock.calls[0][0].data.citaId).toBe(42);
  });

  it('responde 404 si la cita no existe y no guarda nada', async () => {
    const { servicio, create } = servicioCon([]);
    await expect(servicio.crear({ ...BASE, citaId: 99 } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('una cita de otra clienta responde 400 y no guarda nada', async () => {
    const { servicio, create } = servicioCon([{ id: 43, clienteId: '22222222-2222-4222-8222-222222222222' }]);
    await expect(servicio.crear({ ...BASE, citaId: 43 } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('sin citaId funciona como antes', async () => {
    const { servicio, create } = servicioCon([]);
    await servicio.crear({ ...BASE } as any);
    expect(create.mock.calls[0][0].data.citaId ?? null).toBeNull();
  });
});
