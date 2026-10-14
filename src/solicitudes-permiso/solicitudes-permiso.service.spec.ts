import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SolicitudesPermisoService } from './solicitudes-permiso.service';
import { CreateSolicitudPermisoDto } from './dto/create-solicitud-permiso.dto';

/** Resolver solicitudes: nadie resuelve la suya (salvo admin). Motivo con tope de 500 caracteres. */
const SOLICITUD = { id: 3, usuarioId: 'est-1', estado: 'pendiente' };

function servicio() {
  const prisma: any = {
    solicitudPermiso: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === SOLICITUD.id ? { ...SOLICITUD } : null)),
      update: jest.fn(async ({ data }: any) => ({ ...SOLICITUD, ...data })),
    },
  };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  return { s: new SolicitudesPermisoService(prisma), prisma };
}

describe('SolicitudesPermisoService.resolver', () => {
  it('la estilista no aprueba su propia solicitud: 403 y no se escribe', async () => {
    const { s, prisma } = servicio();
    await expect(s.resolver(3, 'est-1', { estado: 'aprobada' }, 'estilista')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.solicitudPermiso.update).not.toHaveBeenCalled();
  });

  it('el admin resuelve la suya; la estilista, la de otra persona', async () => {
    const { s } = servicio();
    await expect(s.resolver(3, 'est-1', { estado: 'aprobada' }, 'admin')).resolves.toMatchObject({ success: true });
    await expect(s.resolver(3, 'est-2', { estado: 'rechazada' }, 'estilista')).resolves.toMatchObject({ success: true });
  });
});

describe('CreateSolicitudPermisoDto.motivo', () => {
  const cuerpo = (motivo: string) =>
    plainToInstance(CreateSolicitudPermisoDto, { tipo: 'permiso', fechaInicio: '2026-10-20', fechaFin: '2026-10-21', motivo });

  it('más de 500 caracteres: error en español', async () => {
    const errores = await validate(cuerpo('a'.repeat(501)));
    expect(errores.map((e) => e.property)).toEqual(['motivo']);
    expect(Object.values(errores[0].constraints ?? {})).toContain('El motivo no puede pasar de 500 caracteres');
  });

  it('500 caracteres se aceptan', async () => {
    expect(await validate(cuerpo('a'.repeat(500)))).toEqual([]);
  });
});
