import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DATOS_NO_COINCIDEN, UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';

/**
 * La pantalla de admin "nuevo usuario" mandaba la respuesta por defecto "Por definir": con el correo y esa
 * respuesta cualquiera obtenía el token de cambio de contraseña. Sin respuesta real no se guarda pregunta
 * ni respuesta, y "Por definir" nunca vale en la verificación (protege las cuentas ya creadas así).
 */
const REGISTRO = {
  nombre: 'Persona Nueva',
  email: 'nueva@example.com',
  telefono: '7710000000',
  password: 'Otra$Llave47',
  fechaNacimiento: '1995-03-10',
  preguntaSeguridad: { pregunta: '¿Color favorito?', respuesta: 'azul' },
  perfilCapilar: { tipoCabello: 'liso' },
  // Ahora también son obligatorios los términos (registro-consentimientos.spec.ts).
  aceptaTerminos: true,
  aceptaAvisoPrivacidad: true,
};

function escenario(usuario: Record<string, unknown> | null = null) {
  const prisma: any = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(usuario),
      create: jest.fn(async ({ data }: any) => ({ id: 'u-nuevo', rol: 'cliente', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    // El alta ahora va en una transacción (registro-consentimientos.spec.ts) y también la del admin registra
    // términos y aviso de privacidad con la versión vigente (consentimientos-edicion.spec.ts).
    versionDocumentoLegal: { findFirst: jest.fn(async ({ where }: any) => ({ slug: where.slug, version: '2.0', hashTexto: 'a'.repeat(64), vigenteDesde: new Date('2026-10-14') })) },
    consentimiento: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const emailService = { sendOTPEmail: jest.fn().mockResolvedValue(undefined) };
  return { servicio: new UsuariosService(prisma as any, emailService as any, {} as any, {} as any), prisma };
}

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

describe('Registro sin respuesta de seguridad real', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const crear = async (extra: Record<string, unknown>) => {
    const { servicio, prisma } = escenario();
    await servicio.crearUsuario({ ...REGISTRO, ...extra } as any, { permitirConfirmado: true, registradoPorId: 'admin-1' });
    return prisma.usuario.create.mock.calls[0][0].data;
  };

  it.each([
    ['"Por definir"', { pregunta: '¿Mascota?', respuesta: 'Por definir' }],
    ['"  por   DEFINIR "', { pregunta: '¿Mascota?', respuesta: '  por   DEFINIR ' }],
    ['respuesta vacía', { pregunta: '¿Mascota?', respuesta: '   ' }],
    ['sin pregunta', undefined],
  ])('%s: pregunta y respuesta quedan en null', async (_caso, preguntaSeguridad) => {
    const data = await crear({ preguntaSeguridad });
    expect(data.preguntaSeguridad).toBeNull();
    expect(data.respuestaSeguridad).toBeNull();
  });

  it('con respuesta real guarda la pregunta y el hash de la respuesta', async () => {
    const data = await crear({});
    expect(data.preguntaSeguridad).toBe('¿Color favorito?');
    expect(await bcrypt.compare('azul', data.respuestaSeguridad)).toBe(true);
  });

  it('el DTO acepta el registro sin preguntaSeguridad (admin que no la captura)', async () => {
    const { preguntaSeguridad: _sin, ...sinPregunta } = REGISTRO;
    await expect(
      pipe.transform(sinPregunta, { type: 'body', metatype: CreateUsuarioDto } as ArgumentMetadata),
    ).resolves.toBeInstanceOf(CreateUsuarioDto);
  });
});

describe('Verificación de la respuesta: "Por definir" nunca vale', () => {
  it.each(['Por definir', 'por definir', ' POR  DEFINIR ', 'pordefinir'])(
    'cuenta guardada con "Por definir": "%s" responde el 400 genérico y no emite token',
    async (respuesta) => {
      const hash = await bcrypt.hash('Por definir', 4);
      const { servicio, prisma } = escenario({ id: 'u-1', email: 'a@example.com', respuestaSeguridad: hash });
      const e = await servicio.validarRespuestaSeguridad('a@example.com', respuesta).catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe(DATOS_NO_COINCIDEN);
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    },
  );

  it('una respuesta real sigue funcionando', async () => {
    const hash = await bcrypt.hash('Firulais', 4);
    const { servicio } = escenario({ id: 'u-1', email: 'a@example.com', respuestaSeguridad: hash });
    await expect(servicio.validarRespuestaSeguridad('a@example.com', 'Firulais')).resolves.toMatchObject({ success: true });
  });
});
