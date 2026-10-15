import { BadRequestException, CanActivate, ExecutionContext, INestApplication, InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OwnerOrAdminGuard } from '../common/guards/owner-or-admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from './usuarios.service';

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsuariosController } = require('./usuarios.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthController } = require('../auth/auth.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require('../auth/auth.service');

/**
 * Datos de salud (alergias) capturados DESPUÉS del registro: si se guardan con el consentimiento expreso
 * (consienteDatosSensibles: true), en la misma transacción queda un consentimiento datos_salud aceptado con la
 * evidencia de la petición. Formulario "perfil" cuando la titular edita su perfil (PATCH /auth/me o
 * PUT /usuarios/:id/perfil) y "admin-usuario" cuando el admin captura los datos de otra persona. Prisma simulado.
 */
const HASH_AVISO = 'fae1b55c1fc51ab41088fdfdf8bb1ab4a84ad7a9eeca1d050e88cb1d100ef1bd';
const CONTEXTO = { ip: '201.140.10.5', userAgent: 'Navegador de prueba' };

function escenario(opciones: { sinAviso?: boolean; alergiasGuardadas?: string | null } = {}) {
  const orden: string[] = [];
  const versiones = jest.fn(async ({ where }: any) =>
    !opciones.sinAviso && where.slug === 'aviso-privacidad'
      ? { slug: 'aviso-privacidad', version: '2.0', hashTexto: HASH_AVISO, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') }
      : null,
  );
  const tx: any = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue({ alergias: opciones.alergiasGuardadas ?? null, recibePromociones: false }),
      update: jest.fn(async ({ where, data }: any) => {
        orden.push('tx.usuario.update');
        return { id: where.id, ...data };
      }),
    },
    consentimiento: {
      create: jest.fn(async ({ data }: any) => {
        orden.push('tx.consentimiento.create');
        return { id: BigInt(1), ...data };
      }),
    },
    versionDocumentoLegal: { findFirst: versiones },
  };
  const prisma: any = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(null),
      // Todo guardado va en la transacción (consentimientos-edicion.spec.ts): fuera de ella no se escribe
      update: jest.fn(() => {
        throw new Error('el guardado debe ir dentro de la transacción');
      }),
    },
    consentimiento: {
      create: jest.fn(() => {
        throw new Error('el consentimiento debe registrarse dentro de la transacción');
      }),
    },
    versionDocumentoLegal: { findFirst: versiones },
    $transaction: jest.fn(async (fn: any) => {
      orden.push('inicio');
      const r = await fn(tx);
      orden.push('fin');
      return r;
    }),
  };
  const servicio = new UsuariosService(prisma, {} as any, {} as any, {} as any);
  return { servicio, prisma, tx, orden };
}

const FILA_SALUD = {
  tipo: 'datos_salud',
  accion: 'aceptado',
  documentoSlug: 'aviso-privacidad',
  documentoVersion: '2.0',
  documentoHash: HASH_AVISO,
  ip: CONTEXTO.ip,
  userAgent: CONTEXTO.userAgent,
  metodo: 'casilla_marcada',
};
const ADMIN = { formulario: 'admin-usuario' as const, contexto: CONTEXTO, registradoPorId: 'admin-1' };

describe('UsuariosService.actualizarPerfilUsuario: alergias con consentimiento (formulario "perfil")', () => {
  it.each([
    ['alergias sueltas', { alergias: 'Látex', consienteDatosSensibles: true }],
    ['alergias dentro de perfilCapilar', { perfilCapilar: { alergias: 'Látex' }, consienteDatosSensibles: true }],
  ])('%s: guarda el perfil y el consentimiento datos_salud en la misma transacción', async (_caso, cuerpo) => {
    const { servicio, prisma, tx, orden } = escenario();
    await servicio.actualizarPerfilUsuario('u-1', cuerpo, { formulario: 'perfil', contexto: CONTEXTO });
    expect(orden).toEqual(['inicio', 'tx.usuario.update', 'tx.consentimiento.create', 'fin']);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    expect(tx.usuario.update.mock.calls[0][0].data).toMatchObject({ alergias: 'Látex' });
    expect(tx.usuario.update.mock.calls[0][0].data).not.toHaveProperty('consienteDatosSensibles');
    const fila = tx.consentimiento.create.mock.calls[0][0].data;
    expect(fila).toMatchObject({ ...FILA_SALUD, usuarioId: 'u-1', formulario: 'perfil', rutaOrigen: '/perfil' });
    expect(fila).not.toHaveProperty('creadoEn');
  });

  it('sin evidencia explícita (llamada interna): formulario "perfil" sin ip ni user agent', async () => {
    const { servicio, tx } = escenario();
    await servicio.actualizarPerfilUsuario('u-1', { alergias: 'Látex', consienteDatosSensibles: true });
    expect(tx.consentimiento.create.mock.calls[0][0].data).toMatchObject({ tipo: 'datos_salud', formulario: 'perfil', ip: null, userAgent: null });
  });

  it.each([
    ['sin alergias', { nombre: 'Ana' }],
    ['alergias vacías', { alergias: '', consienteDatosSensibles: true }],
    ['alergias en blanco', { alergias: '   ', consienteDatosSensibles: true }],
    ['alergias null', { alergias: null }],
    ['consentimiento sin alergias', { nombre: 'Ana', consienteDatosSensibles: true }],
  ])('%s: no registra consentimiento y guarda en la transacción', async (_caso, cuerpo) => {
    const { servicio, tx } = escenario();
    await servicio.actualizarPerfilUsuario('u-1', cuerpo, { formulario: 'perfil', contexto: CONTEXTO });
    expect(tx.usuario.update).toHaveBeenCalledTimes(1);
    expect(tx.consentimiento.create).not.toHaveBeenCalled();
  });

  it('alergias con consienteDatosSensibles distinto de true (el servicio no lo infiere): 400 y no se guarda', async () => {
    const { servicio, tx } = escenario();
    await expect(
      servicio.actualizarPerfilUsuario('u-1', { alergias: 'Látex', consienteDatosSensibles: 'true' }, { formulario: 'perfil', contexto: CONTEXTO }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.usuario.update).not.toHaveBeenCalled();
    expect(tx.consentimiento.create).not.toHaveBeenCalled();
  });

  it('las mismas alergias que ya tiene: no pide la casilla ni registra otra fila', async () => {
    const { servicio, tx } = escenario({ alergiasGuardadas: 'Látex' });
    await servicio.actualizarPerfilUsuario('u-1', { alergias: 'Látex', consienteDatosSensibles: true }, { formulario: 'perfil', contexto: CONTEXTO });
    expect(tx.usuario.update).toHaveBeenCalledTimes(1);
    expect(tx.consentimiento.create).not.toHaveBeenCalled();
  });

  it('si falla el registro del consentimiento, falla el guardado (misma transacción)', async () => {
    const { servicio, tx } = escenario();
    tx.consentimiento.create.mockRejectedValueOnce(new Error('falla simulada'));
    await expect(
      servicio.actualizarPerfilUsuario('u-1', { alergias: 'Látex', consienteDatosSensibles: true }, { formulario: 'perfil', contexto: CONTEXTO }),
    ).rejects.toThrow('falla simulada');
  });

  it('sin una versión publicada del aviso de privacidad: error del servidor y no se guarda (nunca una fila sin documento)', async () => {
    const { servicio, tx } = escenario({ sinAviso: true });
    await expect(
      servicio.actualizarPerfilUsuario('u-1', { alergias: 'Látex', consienteDatosSensibles: true }, { formulario: 'perfil', contexto: CONTEXTO }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(tx.usuario.update).not.toHaveBeenCalled();
    expect(tx.consentimiento.create).not.toHaveBeenCalled();
  });
});

describe('UsuariosService.actualizarUsuario (admin): alergias de una persona con consentimiento declarado', () => {
  it.each([
    ['alergias sueltas', { alergias: 'Amoniaco', consienteDatosSensibles: true }],
    ['alergias dentro de perfilCapilar', { perfilCapilar: { alergias: 'Amoniaco' }, consienteDatosSensibles: true }],
  ])('%s: el consentimiento queda a nombre de la persona, formulario "admin-usuario" y registradoPorId del admin', async (_caso, cuerpo) => {
    const { servicio, prisma, tx, orden } = escenario();
    await servicio.actualizarUsuario('u-2', cuerpo, ADMIN);
    expect(orden).toEqual(['inicio', 'tx.usuario.update', 'tx.consentimiento.create', 'fin']);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    expect(tx.usuario.update.mock.calls[0][0]).toMatchObject({ where: { id: 'u-2' }, data: { alergias: 'Amoniaco' } });
    expect(tx.consentimiento.create.mock.calls[0][0].data).toMatchObject({
      ...FILA_SALUD,
      usuarioId: 'u-2',
      formulario: 'admin-usuario',
      registradoPorId: 'admin-1',
      rutaOrigen: '/admin/usuarios-roles',
    });
  });

  it('sin alergias: guarda sin consentimiento; alergias nuevas sin la casilla: 400 con el mensaje para el personal', async () => {
    const sin = escenario();
    await sin.servicio.actualizarUsuario('u-2', { nombre: 'Ana' }, ADMIN);
    expect(sin.tx.usuario.update).toHaveBeenCalledTimes(1);
    expect(sin.tx.consentimiento.create).not.toHaveBeenCalled();

    const sinCasilla = escenario();
    await expect(sinCasilla.servicio.actualizarUsuario('u-2', { perfilCapilar: { alergias: 'Látex' } }, ADMIN)).rejects.toThrow(
      'Marca que la persona aceptó que registremos sus datos de salud.',
    );
    expect(sinCasilla.tx.usuario.update).not.toHaveBeenCalled();
  });
});

describe('AuthService.updateProfileMe (PATCH /auth/me)', () => {
  it('pasa la petición a actualizarPerfilUsuario con formulario "perfil"', async () => {
    const usuarios = { actualizarPerfilUsuario: jest.fn().mockResolvedValue({ success: true }) };
    const auth = new AuthService({} as any, {} as any, usuarios as any, {} as any, {} as any, undefined);
    const dto = { alergias: 'Látex', consienteDatosSensibles: true };
    await auth.updateProfileMe('u-1', dto, CONTEXTO);
    expect(usuarios.actualizarPerfilUsuario).toHaveBeenCalledWith('u-1', dto, { formulario: 'perfil', contexto: CONTEXTO });
  });
});

/** Sesión simulada: x-usuaria y x-rol en las cabeceras. */
const sesion: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) return false;
    req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
    return true;
  },
};
const pasa: CanActivate = { canActivate: () => true };
const CABECERAS = { 'Content-Type': 'application/json', 'x-forwarded-for': '201.1.1.1, 10.0.0.1', 'user-agent': 'Navegador de prueba' };
// ip: req.ip (la de la conexión, como el límite de peticiones); el x-forwarded-for de quien pide no cuenta
const CONTEXTO_HTTP = { ip: '127.0.0.1', userAgent: 'Navegador de prueba' };
const CUERPO = { alergias: 'Látex', consienteDatosSensibles: true };

async function levantar(controller: unknown, providers: any[]): Promise<{ app: INestApplication; base: string }> {
  const modulo = await Test.createTestingModule({ controllers: [controller as any], providers: [...providers, { provide: PrismaService, useValue: {} }] })
    .overrideGuard(JwtAuthGuard)
    .useValue(sesion)
    .overrideGuard(RolesGuard)
    .useValue(pasa)
    .overrideGuard(OwnerOrAdminGuard)
    .useValue(pasa)
    .compile();
  const app = modulo.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}` };
}

describe('Rutas: la evidencia de la petición llega al guardado', () => {
  const usuariosService = { actualizarPerfilUsuario: jest.fn(), actualizarUsuario: jest.fn() };
  const authService = { updateProfileMe: jest.fn() };
  let usuarios: { app: INestApplication; base: string };
  let auth: { app: INestApplication; base: string };

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    usuarios = await levantar(UsuariosController, [{ provide: UsuariosService, useValue: usuariosService }]);
    auth = await levantar(AuthController, [{ provide: AuthService, useValue: authService }]);
  });

  beforeEach(() => {
    usuariosService.actualizarPerfilUsuario.mockReset().mockResolvedValue({ success: true });
    usuariosService.actualizarUsuario.mockReset().mockResolvedValue({ success: true });
    authService.updateProfileMe.mockReset().mockResolvedValue({ success: true });
  });

  afterAll(async () => {
    await usuarios.app.close();
    await auth.app.close();
    jest.restoreAllMocks();
  });

  const pedir = (base: string, metodo: string, ruta: string, quien: Record<string, string>) =>
    fetch(`${base}/api${ruta}`, { method: metodo, headers: { ...CABECERAS, ...quien }, body: JSON.stringify(CUERPO) });

  it('PATCH /auth/me: ip (req.ip) y user agent', async () => {
    expect((await pedir(auth.base, 'PATCH', '/auth/me', { 'x-usuaria': 'u-1' })).status).toBe(200);
    expect(authService.updateProfileMe).toHaveBeenCalledWith('u-1', expect.objectContaining(CUERPO), CONTEXTO_HTTP);
  });

  it('PUT /usuarios/:id/perfil de la propia titular: formulario "perfil"', async () => {
    expect((await pedir(usuarios.base, 'PUT', '/usuarios/u-1/perfil', { 'x-usuaria': 'u-1' })).status).toBe(200);
    expect(usuariosService.actualizarPerfilUsuario).toHaveBeenCalledWith('u-1', expect.objectContaining(CUERPO), {
      formulario: 'perfil',
      contexto: CONTEXTO_HTTP,
    });
  });

  it('PUT /usuarios/:id/perfil hecho por el admin sobre otra persona: formulario "admin-usuario" con su id', async () => {
    expect((await pedir(usuarios.base, 'PUT', '/usuarios/u-2/perfil', { 'x-usuaria': 'admin-1', 'x-rol': 'admin' })).status).toBe(200);
    expect(usuariosService.actualizarPerfilUsuario).toHaveBeenCalledWith('u-2', expect.objectContaining(CUERPO), {
      formulario: 'admin-usuario',
      contexto: CONTEXTO_HTTP,
      registradoPorId: 'admin-1',
    });
  });

  it('PUT /usuarios/:id (admin): formulario "admin-usuario" con la evidencia de la petición y su id', async () => {
    expect((await pedir(usuarios.base, 'PUT', '/usuarios/u-2', { 'x-usuaria': 'admin-1', 'x-rol': 'admin' })).status).toBe(200);
    expect(usuariosService.actualizarUsuario).toHaveBeenCalledWith('u-2', expect.objectContaining(CUERPO), {
      formulario: 'admin-usuario',
      contexto: CONTEXTO_HTTP,
      registradoPorId: 'admin-1',
    });
  });

  it('PUT /usuarios/:id del admin sobre su propia cuenta: es la titular (formulario "perfil")', async () => {
    expect((await pedir(usuarios.base, 'PUT', '/usuarios/admin-1', { 'x-usuaria': 'admin-1', 'x-rol': 'admin' })).status).toBe(200);
    expect(usuariosService.actualizarUsuario).toHaveBeenCalledWith('admin-1', expect.objectContaining(CUERPO), {
      formulario: 'perfil',
      contexto: CONTEXTO_HTTP,
    });
  });
});
