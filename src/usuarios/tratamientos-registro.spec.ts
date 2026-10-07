import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

/** Tratamientos en el registro y en el perfil, y `confirmado` del registro público. Prisma y correo simulados. */

const REGISTRO = {
  nombre: 'Persona Nueva',
  email: 'nueva@example.com',
  telefono: '7710000000',
  password: 'Otra$Llave47',
  fechaNacimiento: '1995-03-10',
  preguntaSeguridad: { pregunta: '¿Color favorito?', respuesta: 'azul' },
  perfilCapilar: { tipoCabello: 'liso' },
  aceptaAvisoPrivacidad: true,
};

function escenario() {
  const prisma = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 'u-nuevo', rol: 'cliente', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'u-1', ...data })),
    },
  };
  const emailService = { sendOTPEmail: jest.fn().mockResolvedValue(undefined) };
  const servicio = new UsuariosService(prisma as any, emailService as any, {} as any, {} as any);
  return { servicio, prisma };
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validar = (metatype: any, valor: unknown) =>
  pipe.transform(valor, { type: 'body', metatype } as ArgumentMetadata);

describe('Registro: tratamientos y confirmado', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const crear = async (perfilCapilar: Record<string, unknown>, extra: Record<string, unknown> = {}, opciones?: any) => {
    const { servicio, prisma } = escenario();
    await servicio.crearUsuario({ ...REGISTRO, perfilCapilar: { tipoCabello: 'liso', ...perfilCapilar }, ...extra } as any, opciones);
    return prisma.usuario.create.mock.calls[0][0].data;
  };

  it('guarda tratamientosQuimicos y tratamientos (sanitizado) tal como los manda la app', async () => {
    const data = await crear({ tratamientosQuimicos: true, tratamientos: '  Keratina\u0000 en 2025  ' });
    expect(data).toMatchObject({ tratamientosQuimicos: true, tratamientos: 'Keratina en 2025' });
  });

  it('tratamientosQuimicos false: tratamientos queda en null aunque traiga texto', async () => {
    const data = await crear({ tratamientosQuimicos: false, tratamientos: 'Tinte' });
    expect(data).toMatchObject({ tratamientosQuimicos: false, tratamientos: null });
  });

  it('texto sin la bandera: la bandera queda en true', async () => {
    const data = await crear({ tratamientos: 'Alaciado' });
    expect(data).toMatchObject({ tratamientosQuimicos: true, tratamientos: 'Alaciado' });
  });

  it('sin nada: false y null', async () => {
    const data = await crear({});
    expect(data).toMatchObject({ tratamientosQuimicos: false, tratamientos: null });
  });

  it('confirmado true desde el registro público: la cuenta nace sin confirmar', async () => {
    expect((await crear({}, { confirmado: true })).confirmado).toBe(false);
    expect((await crear({}, { confirmado: true }, { permitirConfirmado: false })).confirmado).toBe(false);
  });

  it('con sesión de admin (permitirConfirmado) se respeta confirmado', async () => {
    expect((await crear({}, { confirmado: true }, { permitirConfirmado: true })).confirmado).toBe(true);
    expect((await crear({}, {}, { permitirConfirmado: true })).confirmado).toBe(false);
  });

  it('el DTO del registro rechaza tratamientos de más de 1000 caracteres', async () => {
    await expect(
      validar(CreateUsuarioDto, { ...REGISTRO, perfilCapilar: { tipoCabello: 'liso', tratamientos: 'x'.repeat(1001) } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar(CreateUsuarioDto, { ...REGISTRO, perfilCapilar: { tipoCabello: 'liso', tratamientosQuimicos: true, tratamientos: 'Tinte' } }),
    ).resolves.toBeDefined();
  });
});

describe('PATCH /auth/me: tratamientos', () => {
  afterEach(() => jest.restoreAllMocks());

  const actualizar = async (cuerpo: Record<string, unknown>) => {
    const { servicio, prisma } = escenario();
    await servicio.actualizarPerfilUsuario('u-1', cuerpo);
    return prisma.usuario.update.mock.calls[0][0];
  };

  it('acepta los dos campos sueltos, con el texto sanitizado', async () => {
    const { data } = await actualizar({ tratamientosQuimicos: true, tratamientos: '  Tinte\u0000  ' });
    expect(data).toEqual({ tratamientosQuimicos: true, tratamientos: 'Tinte' });
  });

  it('y dentro de perfilCapilar', async () => {
    const { data } = await actualizar({ perfilCapilar: { tratamientosQuimicos: true, tratamientos: 'Decoloración' } });
    expect(data).toEqual({ tratamientosQuimicos: true, tratamientos: 'Decoloración' });
  });

  it('tratamientosQuimicos false: tratamientos queda en null', async () => {
    const { data } = await actualizar({ tratamientosQuimicos: false, tratamientos: 'Tinte' });
    expect(data).toEqual({ tratamientosQuimicos: false, tratamientos: null });
  });

  it.each([null, '', '   '])('tratamientos %p lo borra', async (valor) => {
    const { data } = await actualizar({ tratamientos: valor });
    expect(data).toEqual({ tratamientos: null });
  });

  it('texto sin la bandera: la bandera queda en true', async () => {
    const { data } = await actualizar({ tratamientos: 'Permanente' });
    expect(data).toEqual({ tratamientosQuimicos: true, tratamientos: 'Permanente' });
  });

  it('sin los campos no los toca', async () => {
    const { data } = await actualizar({ nombre: 'Otra' });
    expect(data).not.toHaveProperty('tratamientos');
    expect(data).not.toHaveProperty('tratamientosQuimicos');
  });

  it('dentro de perfilCapilar con tipos o longitud inválidos: 400', async () => {
    const { servicio } = escenario();
    await expect(servicio.actualizarPerfilUsuario('u-1', { perfilCapilar: { tratamientosQuimicos: 'sí' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.actualizarPerfilUsuario('u-1', { perfilCapilar: { tratamientos: 42 } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.actualizarPerfilUsuario('u-1', { perfilCapilar: { tratamientos: 'x'.repeat(1001) } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('la respuesta (y GET /auth/me) incluye los dos campos', async () => {
    const { select } = await actualizar({ tratamientos: 'Tinte' });
    expect(select).toMatchObject({ tratamientos: true, tratamientosQuimicos: true });
  });

  it('el DTO acepta texto, vacío y null; rechaza más de 1000 caracteres y campos desconocidos', async () => {
    await expect(validar(UpdateUsuarioDto, { tratamientosQuimicos: true, tratamientos: 'Tinte' })).resolves.toBeDefined();
    await expect(validar(UpdateUsuarioDto, { tratamientos: '' })).resolves.toBeDefined();
    await expect(validar(UpdateUsuarioDto, { tratamientos: null })).resolves.toBeDefined();
    await expect(validar(UpdateUsuarioDto, { tratamientos: 'x'.repeat(1001) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar(UpdateUsuarioDto, { tratamientosQuimicos: 'sí' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar(UpdateUsuarioDto, { campoDesconocido: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PUT /usuarios/:id de admin aplica la misma regla y sanitización', async () => {
    const regla = escenario();
    await regla.servicio.actualizarUsuario('u-1', { tratamientosQuimicos: false, tratamientos: 'Tinte' });
    expect(regla.prisma.usuario.update.mock.calls[0][0].data).toMatchObject({ tratamientosQuimicos: false, tratamientos: null });

    const sanitiza = escenario();
    await sanitiza.servicio.actualizarUsuario('u-1', { tratamientosQuimicos: true, tratamientos: '  Tinte\u0000 rojo  ' });
    expect(sanitiza.prisma.usuario.update.mock.calls[0][0].data).toMatchObject({ tratamientosQuimicos: true, tratamientos: 'Tinte rojo' });
  });
});
