import { BadRequestException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

// Rutas que guardan usuarios.foto desde el cliente:
// PATCH /api/auth/me y PUT /api/usuarios/:id/perfil → actualizarPerfilUsuario
// PUT /api/usuarios/:id (admin) → actualizarUsuario
const NUBE = 'nube-de-prueba';
const PROPIA = `https://res.cloudinary.com/${NUBE}/image/upload/v1/avatares/usuario_u-1.jpg`;
const GOOGLE = 'https://lh3.googleusercontent.com/a/foto-de-google=s96-c';
const AJENA = 'https://evil.com/rastreo.png';
const MENSAJE = 'La foto no es válida: debe ser una imagen subida desde el sitio.';

const nubeOriginal = process.env.CLOUDINARY_CLOUD_NAME;
beforeEach(() => {
  process.env.CLOUDINARY_CLOUD_NAME = NUBE;
});
afterAll(() => {
  if (nubeOriginal === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
  else process.env.CLOUDINARY_CLOUD_NAME = nubeOriginal;
});

function servicioCon(fotoGuardada: string | null) {
  const prisma = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue({ foto: fotoGuardada }),
      update: jest.fn(async ({ data }) => ({ id: 'u-1', ...data })),
    },
  };
  const servicio = new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
  return { servicio, prisma };
}

describe.each([
  ['actualizarPerfilUsuario', (s: UsuariosService, foto: unknown) => s.actualizarPerfilUsuario('u-1', { foto })],
  ['actualizarUsuario (admin)', (s: UsuariosService, foto: unknown) => s.actualizarUsuario('u-1', { foto })],
])('Validación de foto en %s', (_nombre, actualizar) => {
  it('rechaza con 400 una URL ajena y no guarda nada', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    const intento = actualizar(servicio, AJENA);
    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow(MENSAJE);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('guarda una imagen de la cuenta propia de Cloudinary', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, PROPIA);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBe(PROPIA);
  });

  it('acepta reenviar la foto de Google que ya tiene guardada', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, GOOGLE);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBe(GOOGLE);
  });

  it('null quita la foto sin consultar la foto guardada', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, null);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBeNull();
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('sin foto en el cuerpo no consulta ni valida', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, undefined);
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(prisma.usuario.update).toHaveBeenCalled();
  });

  it('sin CLOUDINARY_CLOUD_NAME rechaza una imagen de Cloudinary nueva', async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    const { servicio, prisma } = servicioCon(null);
    await expect(actualizar(servicio, PROPIA)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
});

describe('Cadena vacía', () => {
  it('en el perfil se guarda como null (como antes)', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await servicio.actualizarPerfilUsuario('u-1', { foto: '' });
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBeNull();
  });

  it('en el admin se guarda tal cual (como antes)', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await servicio.actualizarUsuario('u-1', { foto: '' });
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBe('');
  });
});
