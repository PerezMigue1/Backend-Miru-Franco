import { ArgumentMetadata, BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsuariosController } = require('./usuarios.controller');

/**
 * POST /usuarios/registro: términos y aviso de privacidad obligatorios, consentimientos registrados en la MISMA
 * transacción que la cuenta, y minimización (fecha de nacimiento, perfil capilar y datos de salud opcionales).
 * Prisma y correo simulados.
 */
const HASH_TERMINOS = '6105ab7970cb21bbc1f8c629bd7da5a9952061cbc83741c5eced5ea68d1b4d69';
const HASH_AVISO = 'fae1b55c1fc51ab41088fdfdf8bb1ab4a84ad7a9eeca1d050e88cb1d100ef1bd';
const DOCUMENTOS = [
  { slug: 'terminos', version: '2.0', hash: HASH_TERMINOS },
  { slug: 'aviso-privacidad', version: '2.0', hash: HASH_AVISO },
];
const CONTEXTO = { ip: '201.140.10.5', userAgent: 'Navegador de prueba' };

const REGISTRO = {
  nombre: 'Persona Nueva',
  email: 'nueva@example.com',
  telefono: '7710000000',
  password: 'Otra$Llave47',
  preguntaSeguridad: { pregunta: '¿Color favorito?', respuesta: 'azul' },
  aceptaTerminos: true,
  aceptaAvisoPrivacidad: true,
};

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function mensajes(valor: unknown): Promise<string[]> {
  try {
    await pipe.transform(valor, { type: 'body', metatype: CreateUsuarioDto } as ArgumentMetadata);
    return [];
  } catch (e) {
    const r = (e as BadRequestException).getResponse() as { message?: string | string[] };
    return Array.isArray(r.message) ? r.message : [String(r.message)];
  }
}

function escenario() {
  const versiones = [
    { id: 2, slug: 'terminos', version: '2.0', hashTexto: HASH_TERMINOS, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') },
    { id: 3, slug: 'aviso-privacidad', version: '2.0', hashTexto: HASH_AVISO, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') },
  ];
  const orden: string[] = [];
  const tx: any = {
    usuario: {
      create: jest.fn(async ({ data }: any) => {
        orden.push('usuario.create');
        return { id: 'u-nuevo', rol: 'cliente', ...data };
      }),
    },
    consentimiento: {
      createMany: jest.fn(async ({ data }: any) => {
        orden.push('consentimiento.createMany');
        return { count: data.length };
      }),
    },
  };
  const prisma: any = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(() => {
        throw new Error('la cuenta debe crearse dentro de la transacción');
      }),
    },
    consentimiento: {
      createMany: jest.fn(() => {
        throw new Error('los consentimientos deben registrarse dentro de la transacción');
      }),
    },
    versionDocumentoLegal: {
      findFirst: jest.fn(async ({ where }: any) =>
        versiones
          .filter((v) => v.slug === where.slug && (!where.version || v.version === where.version) && (!where.hashTexto || v.hashTexto === where.hashTexto))
          .filter((v) => !where.vigenteDesde || v.vigenteDesde <= where.vigenteDesde.lte)[0] ?? null,
      ),
    },
    $transaction: jest.fn(async (fn: any) => {
      orden.push('inicio');
      const r = await fn(tx);
      orden.push('fin');
      return r;
    }),
  };
  const emailService = { sendOTPEmail: jest.fn().mockResolvedValue(undefined) };
  const servicio = new UsuariosService(prisma, emailService as any, {} as any, {} as any);
  return { servicio, prisma, tx, orden, emailService };
}

describe('CreateUsuarioDto: términos obligatorios y minimización', () => {
  it('el registro mínimo (sin fecha de nacimiento, sin perfil capilar, sin datos de salud) pasa', async () => {
    expect(await mensajes(REGISTRO)).toEqual([]);
  });

  it('sin aceptaTerminos (la app móvil actual no lo manda): pasa; los términos quedan pendientes (compatibilidad temporal)', async () => {
    expect(await mensajes((({ aceptaTerminos: _t, ...resto }) => resto)(REGISTRO))).toEqual([]);
  });

  it.each([
    ['aceptaTerminos false', { ...REGISTRO, aceptaTerminos: false }],
    ['aceptaTerminos "true" (texto)', { ...REGISTRO, aceptaTerminos: 'true' }],
  ])('%s: 400 "Debes aceptar los términos y condiciones"', async (_caso, cuerpo) => {
    expect(await mensajes(cuerpo)).toEqual(expect.arrayContaining([expect.stringContaining('Debes aceptar los términos y condiciones')]));
  });

  it('el aviso de privacidad sigue siendo obligatorio', async () => {
    expect(await mensajes({ ...REGISTRO, aceptaAvisoPrivacidad: false })).toEqual(
      expect.arrayContaining([expect.stringContaining('Debes aceptar el aviso de privacidad')]),
    );
  });

  it('fecha de nacimiento opcional; si viene, debe ser una fecha', async () => {
    expect(await mensajes({ ...REGISTRO, fechaNacimiento: '1995-03-10' })).toEqual([]);
    expect((await mensajes({ ...REGISTRO, fechaNacimiento: 'ayer' })).length).toBeGreaterThan(0);
  });

  it('perfil capilar opcional, y dentro de él también el tipo de cabello (si viene, del enum)', async () => {
    expect(await mensajes({ ...REGISTRO, perfilCapilar: { colorNatural: 'Castaño' } })).toEqual([]);
    expect(await mensajes({ ...REGISTRO, perfilCapilar: { tipoCabello: 'afro' } })).toEqual(
      expect.arrayContaining([expect.stringContaining('El tipo de cabello debe ser liso, ondulado o rizado')]),
    );
  });

  it('el teléfono sigue obligatorio (recuperación de cuenta por SMS y contacto del salón por citas)', async () => {
    const { telefono: _t, ...sinTelefono } = REGISTRO;
    expect((await mensajes(sinTelefono)).length).toBeGreaterThan(0);
  });

  it('acepta recibePromociones y los documentos aceptados (slug, versión y hash)', async () => {
    expect(await mensajes({ ...REGISTRO, recibePromociones: true, documentos: DOCUMENTOS })).toEqual([]);
  });

  it.each([
    ['slug desconocido', [{ slug: 'otro', version: '2.0', hash: HASH_TERMINOS }]],
    ['versión sin forma X.Y', [{ slug: 'terminos', version: 'dos', hash: HASH_TERMINOS }]],
    ['hash que no es SHA-256', [{ slug: 'terminos', version: '2.0', hash: 'abc' }]],
    ['campo de más', [{ slug: 'terminos', version: '2.0', hash: HASH_TERMINOS, vigente: true }]],
  ])('documentos con %s: 400', async (_caso, documentos) => {
    expect((await mensajes({ ...REGISTRO, documentos })).length).toBeGreaterThan(0);
  });

  it('acepta rutaOrigen (página donde se marcaron las casillas), de hasta 300 caracteres', async () => {
    expect(await mensajes({ ...REGISTRO, rutaOrigen: '/register' })).toEqual([]);
    expect(await mensajes({ ...REGISTRO, rutaOrigen: `/${'x'.repeat(300)}` })).toEqual(
      expect.arrayContaining([expect.stringContaining('La ruta de origen no puede pasar de 300 caracteres')]),
    );
    expect((await mensajes({ ...REGISTRO, rutaOrigen: 5 })).length).toBeGreaterThan(0);
  });
});

describe('UsuariosService.crearUsuario: consentimientos en la misma transacción', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('crea la cuenta y registra terminos y aviso_privacidad dentro de la misma transacción, con ip y user agent', async () => {
    const { servicio, tx, orden } = escenario();
    await servicio.crearUsuario({ ...REGISTRO, documentos: DOCUMENTOS } as any, { contexto: CONTEXTO });
    expect(orden).toEqual(['inicio', 'usuario.create', 'consentimiento.createMany', 'fin']);
    const filas = tx.consentimiento.createMany.mock.calls[0][0].data;
    expect(filas).toEqual([
      expect.objectContaining({ usuarioId: 'u-nuevo', tipo: 'terminos', documentoSlug: 'terminos', documentoVersion: '2.0', documentoHash: HASH_TERMINOS, accion: 'aceptado' }),
      expect.objectContaining({ usuarioId: 'u-nuevo', tipo: 'aviso_privacidad', documentoSlug: 'aviso-privacidad', documentoVersion: '2.0', documentoHash: HASH_AVISO, accion: 'aceptado' }),
    ]);
    for (const fila of filas) {
      expect(fila).toMatchObject({ ip: CONTEXTO.ip, userAgent: CONTEXTO.userAgent, formulario: 'registro', metodo: 'casilla_marcada' });
      expect(fila).not.toHaveProperty('creadoEn');
    }
  });

  it('sin aceptaTerminos (app móvil actual): crea la cuenta con aviso_privacidad y SIN fila de terminos, que queda pendiente para su siguiente inicio de sesión', async () => {
    const { servicio, tx } = escenario();
    const { aceptaTerminos: _t, ...sinTerminos } = REGISTRO;
    await servicio.crearUsuario({ ...sinTerminos, documentos: DOCUMENTOS } as any, { contexto: CONTEXTO });
    const tipos = tx.consentimiento.createMany.mock.calls[0][0].data.map((f: any) => f.tipo);
    expect(tipos).toEqual(['aviso_privacidad']);
  });

  it('el alta del admin sigue exigiendo aceptaTerminos: sin el campo responde 400 y no crea nada', async () => {
    const { servicio, tx } = escenario();
    const { aceptaTerminos: _t, ...sinTerminos } = REGISTRO;
    await expect(servicio.crearUsuario(sinTerminos as any, { permitirConfirmado: true, registradoPorId: 'admin-1', contexto: CONTEXTO })).rejects.toThrow(
      'Debes aceptar los términos y condiciones',
    );
    expect(tx.usuario.create).not.toHaveBeenCalled();
  });

  it('promociones solo si recibePromociones es true; datos_salud solo con alergias y consentimiento expreso', async () => {
    const sin = escenario();
    await sin.servicio.crearUsuario({ ...REGISTRO, recibePromociones: false } as any, { contexto: CONTEXTO });
    expect(sin.tx.consentimiento.createMany.mock.calls[0][0].data.map((f: any) => f.tipo)).toEqual(['terminos', 'aviso_privacidad']);

    const con = escenario();
    await con.servicio.crearUsuario(
      { ...REGISTRO, recibePromociones: true, perfilCapilar: { tipoCabello: 'liso', alergias: 'Amoniaco' }, consienteDatosSensibles: true } as any,
      { contexto: CONTEXTO },
    );
    const filas = con.tx.consentimiento.createMany.mock.calls[0][0].data;
    expect(filas.map((f: any) => f.tipo)).toEqual(['terminos', 'aviso_privacidad', 'promociones', 'datos_salud']);
    // Las finalidades secundarias se aceptan con la versión del aviso de privacidad que las describe
    expect(filas[2]).toMatchObject({ documentoSlug: 'aviso-privacidad', documentoVersion: '2.0' });
    expect(con.tx.usuario.create.mock.calls[0][0].data).toMatchObject({ recibePromociones: true, alergias: 'Amoniaco' });
  });

  it('sin documentos en el cuerpo toma la versión vigente de cada documento obligatorio', async () => {
    const { servicio, tx } = escenario();
    await servicio.crearUsuario(REGISTRO as any, { contexto: CONTEXTO });
    expect(tx.consentimiento.createMany.mock.calls[0][0].data.map((f: any) => [f.documentoSlug, f.documentoVersion, f.documentoHash])).toEqual([
      ['terminos', '2.0', HASH_TERMINOS],
      ['aviso-privacidad', '2.0', HASH_AVISO],
    ]);
  });

  it('versión de documento desconocida: 400 y no se crea la cuenta', async () => {
    const { servicio, prisma, tx } = escenario();
    await expect(
      servicio.crearUsuario({ ...REGISTRO, documentos: [{ slug: 'terminos', version: '9.9', hash: HASH_TERMINOS }] } as any, { contexto: CONTEXTO }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.usuario.create).not.toHaveBeenCalled();
  });

  it('si falla el registro de consentimientos, la transacción falla y no se envía el correo de activación', async () => {
    const { servicio, tx, emailService } = escenario();
    tx.consentimiento.createMany.mockRejectedValueOnce(new Error('falla simulada'));
    await expect(servicio.crearUsuario(REGISTRO as any, { contexto: CONTEXTO })).rejects.toThrow('falla simulada');
    expect(emailService.sendOTPEmail).not.toHaveBeenCalled();
  });

  it('sin fecha de nacimiento ni perfil capilar guarda null (no una fecha inválida)', async () => {
    const { servicio, tx } = escenario();
    await servicio.crearUsuario(REGISTRO as any, { contexto: CONTEXTO });
    const data = tx.usuario.create.mock.calls[0][0].data;
    expect(data.fechaNacimiento).toBeNull();
    expect(data.tipoCabello ?? null).toBeNull();
    expect(data.alergias ?? null).toBeNull();
  });

  it('perfil capilar sin tipo de cabello: queda en null (no se inventa "liso")', async () => {
    const { servicio, tx } = escenario();
    await servicio.crearUsuario({ ...REGISTRO, perfilCapilar: { colorNatural: 'Castaño' } } as any, { contexto: CONTEXTO });
    expect(tx.usuario.create.mock.calls[0][0].data).toMatchObject({ tipoCabello: null, colorNatural: 'Castaño' });
  });

  it('alta hecha por el admin (pantalla "nuevo usuario"): registra terminos y aviso_privacidad con registradoPorId del admin', async () => {
    const { servicio, tx, orden } = escenario();
    await servicio.crearUsuario(REGISTRO as any, { permitirConfirmado: true, contexto: CONTEXTO, registradoPorId: 'admin-1' });
    expect(orden).toEqual(['inicio', 'usuario.create', 'consentimiento.createMany', 'fin']);
    const filas = tx.consentimiento.createMany.mock.calls[0][0].data;
    expect(filas.map((f: any) => [f.tipo, f.registradoPorId, f.formulario])).toEqual([
      ['terminos', 'admin-1', 'admin-usuario'],
      ['aviso_privacidad', 'admin-1', 'admin-usuario'],
    ]);
  });

  it('cada consentimiento guarda la ruta de origen que manda el formulario; sin ella, "/register" (la página del alta)', async () => {
    const con = escenario();
    await con.servicio.crearUsuario({ ...REGISTRO, rutaOrigen: '/registro-salon' } as any, { contexto: CONTEXTO });
    for (const fila of con.tx.consentimiento.createMany.mock.calls[0][0].data) expect(fila.rutaOrigen).toBe('/registro-salon');

    for (const rutaOrigen of [undefined, '', '   ']) {
      const sin = escenario();
      await sin.servicio.crearUsuario({ ...REGISTRO, rutaOrigen } as any, { contexto: CONTEXTO });
      for (const fila of sin.tx.consentimiento.createMany.mock.calls[0][0].data) expect(fila.rutaOrigen).toBe('/register');
    }
  });
});

describe('Ruta POST /api/usuarios/registro: evidencia de la petición', () => {
  let app: INestApplication;
  let base: string;
  const usuariosService = { crearUsuario: jest.fn() };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [UsuariosController],
      providers: [
        { provide: UsuariosService, useValue: usuariosService },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .overrideGuard(SesionOpcionalGuard)
      // Sesión opcional de prueba: x-usuaria y x-rol en las cabeceras
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          if (req.headers['x-usuaria']) req.user = { id: req.headers['x-usuaria'], rol: req.headers['x-rol'] ?? 'cliente' };
          return true;
        },
      })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => usuariosService.crearUsuario.mockReset().mockResolvedValue({ success: true }));

  it('con sesión de admin pasa permitirConfirmado y su id (registradoPorId) para las filas del alta', async () => {
    const r = await fetch(`${base}/api/usuarios/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usuaria': 'admin-1', 'x-rol': 'admin', 'user-agent': 'Navegador de prueba' },
      body: JSON.stringify(REGISTRO),
    });
    expect(r.status).toBe(201);
    expect(usuariosService.crearUsuario).toHaveBeenCalledWith(expect.anything(), {
      permitirConfirmado: true,
      contexto: { ip: '127.0.0.1', userAgent: 'Navegador de prueba' },
      registradoPorId: 'admin-1',
    });
  });

  it('con sesión de otro rol: ni permitirConfirmado ni registradoPorId', async () => {
    await fetch(`${base}/api/usuarios/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-usuaria': 'est-1', 'x-rol': 'estilista' },
      body: JSON.stringify(REGISTRO),
    });
    expect(usuariosService.crearUsuario.mock.calls[0][1]).toEqual({ permitirConfirmado: false, contexto: expect.anything() });
  });

  afterAll(async () => {
    await app.close();
  });

  it('pasa al servicio la ip (req.ip, como el límite de peticiones; no el x-forwarded-for de quien pide) y el user agent, y la ruta de origen del cuerpo', async () => {
    const r = await fetch(`${base}/api/usuarios/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '201.1.1.1, 10.0.0.1', 'user-agent': 'Navegador de prueba' },
      body: JSON.stringify({ ...REGISTRO, rutaOrigen: '/register' }),
    });
    expect(r.status).toBe(201);
    expect(usuariosService.crearUsuario).toHaveBeenCalledWith(expect.objectContaining({ rutaOrigen: '/register' }), {
      permitirConfirmado: false,
      contexto: { ip: '127.0.0.1', userAgent: 'Navegador de prueba' },
    });
  });
});

describe('POST /api/usuarios/registro de punta a punta: la evidencia queda guardada en cada consentimiento', () => {
  let app: INestApplication;
  let base: string;
  let actual: ReturnType<typeof escenario>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [UsuariosController],
      providers: [
        // El servicio real con Prisma y correo simulados: lo que llega a la base sale de la petición HTTP
        { provide: UsuariosService, useFactory: () => ({ crearUsuario: (...a: unknown[]) => (actual.servicio.crearUsuario as any)(...a) }) },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false })
      .overrideGuard(SesionOpcionalGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    actual = escenario();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app.close();
  });

  const registrar = (cuerpo: unknown) =>
    fetch(`${base}/api/usuarios/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '201.1.1.1, 10.0.0.1', 'user-agent': 'Navegador de prueba' },
      body: JSON.stringify(cuerpo),
    });

  it('ip (req.ip; el x-forwarded-for de quien pide no cuenta), user agent y la ruta de origen que manda la web', async () => {
    expect((await registrar({ ...REGISTRO, rutaOrigen: '/register' })).status).toBe(201);
    const filas = actual.tx.consentimiento.createMany.mock.calls[0][0].data;
    expect(filas.map((f: any) => f.tipo)).toEqual(['terminos', 'aviso_privacidad']);
    for (const fila of filas) {
      expect(fila).toMatchObject({ usuarioId: 'u-nuevo', ip: '127.0.0.1', userAgent: 'Navegador de prueba', rutaOrigen: '/register', formulario: 'registro' });
    }
  });

  it('sin rutaOrigen en el cuerpo guarda "/register"', async () => {
    expect((await registrar(REGISTRO)).status).toBe(201);
    for (const fila of actual.tx.consentimiento.createMany.mock.calls[0][0].data) {
      expect(fila).toMatchObject({ ip: '127.0.0.1', userAgent: 'Navegador de prueba', rutaOrigen: '/register' });
    }
  });
});
