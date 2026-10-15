import { BadRequestException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { MENSAJE_URL_A_MANO, esPublicIdDe } from '../subidas/imagenes-subidas';

// Rutas que guardan usuarios.foto desde el cliente:
// PATCH /api/auth/me y PUT /api/usuarios/:id/perfil → actualizarPerfilUsuario
// PUT /api/usuarios/:id (admin) → actualizarUsuario: solo la foto que ya tenía, quitarla o una subida propia de
// usuarios/ con "Subir foto" (la regla completa de la subida se prueba en src/subidas).
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

/** Evidencia de PUT /usuarios/:id hecho por el admin (usuarios.controller). */
const ADMIN = { formulario: 'admin-usuario' as const, contexto: { ip: null, userAgent: null }, registradoPorId: 'admin-1' };
/** Lo que validarFotoDelCliente consulta (la foto guardada); guardarEdicion lee otra cosa (alergias y promociones). */
const CONSULTA_FOTO = expect.objectContaining({ select: { foto: true } });

function servicioCon(fotoGuardada: string | null) {
  const prisma: any = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue({ foto: fotoGuardada }),
      update: jest.fn(async ({ data }) => ({ id: 'u-1', ...data })),
    },
  };
  // El guardado va en una transacción (consentimientos-edicion.spec.ts): aquí la transacción usa el mismo cliente
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  // Subida segura simulada: un public_id propio de su carpeta se cambia por su URL; cualquier otra cosa es 400.
  const subidas = {
    resolverImagen: jest.fn(async (_quien: string, uso: any, valor: string) => {
      if (esPublicIdDe(uso, valor)) return `https://res.cloudinary.com/${NUBE}/image/upload/v1/${valor}.jpg`;
      throw new BadRequestException(MENSAJE_URL_A_MANO);
    }),
  };
  const servicio = new UsuariosService(prisma as any, {} as any, {} as any, {} as any, subidas as any);
  return { servicio, prisma, subidas };
}

describe.each([
  ['actualizarPerfilUsuario', (s: UsuariosService, foto: unknown) => s.actualizarPerfilUsuario('u-1', { foto })],
])('Validación de foto en %s (perfil propio, igual que antes)', (_nombre, actualizar) => {
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
    expect(prisma.usuario.findUnique).not.toHaveBeenCalledWith(CONSULTA_FOTO);
  });

  it('sin foto en el cuerpo no consulta ni valida', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, undefined);
    expect(prisma.usuario.findUnique).not.toHaveBeenCalledWith(CONSULTA_FOTO);
    expect(prisma.usuario.update).toHaveBeenCalled();
  });

  it('sin CLOUDINARY_CLOUD_NAME rechaza una imagen de Cloudinary nueva', async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    const { servicio, prisma } = servicioCon(null);
    await expect(actualizar(servicio, PROPIA)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });
});

describe('Validación de foto en actualizarUsuario (admin): solo subidas propias', () => {
  const actualizar = (s: UsuariosService, foto: unknown) => s.actualizarUsuario('u-1', { foto }, ADMIN);

  it.each([
    ['una URL ajena', AJENA],
    ['una imagen de Cloudinary escrita a mano', PROPIA],
  ])('rechaza con 400 %s y no guarda nada', async (_caso, foto) => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    const intento = actualizar(servicio, foto);
    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow(MENSAJE_URL_A_MANO);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('una subida propia de usuarios/ se guarda con la URL que arma el servidor', async () => {
    const { servicio, prisma, subidas } = servicioCon(GOOGLE);
    const publicId = 'usuarios/panel_' + '0'.repeat(32);
    await actualizar(servicio, publicId);
    expect(subidas.resolverImagen).toHaveBeenCalledWith('admin-1', 'usuarios', publicId, GOOGLE);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBe(`https://res.cloudinary.com/${NUBE}/image/upload/v1/${publicId}.jpg`);
  });

  it('acepta reenviar la foto que ya tiene guardada', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, GOOGLE);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBe(GOOGLE);
  });

  it('null quita la foto sin consultar la foto guardada', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, null);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBeNull();
    expect(prisma.usuario.findUnique).not.toHaveBeenCalledWith(CONSULTA_FOTO);
  });

  it('sin foto en el cuerpo no consulta ni valida', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await actualizar(servicio, undefined);
    expect(prisma.usuario.findUnique).not.toHaveBeenCalledWith(CONSULTA_FOTO);
    expect(prisma.usuario.update).toHaveBeenCalled();
  });
});

describe('Cadena vacía', () => {
  it('en el perfil se guarda como null (como antes)', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await servicio.actualizarPerfilUsuario('u-1', { foto: '' });
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBeNull();
  });

  it('en el admin quita la foto (se guarda null, igual que en el perfil)', async () => {
    const { servicio, prisma } = servicioCon(GOOGLE);
    await servicio.actualizarUsuario('u-1', { foto: '' }, ADMIN);
    expect(prisma.usuario.update.mock.calls[0][0].data.foto).toBeNull();
  });
});
